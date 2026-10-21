-- Shares a single savings goal with a guest.
--
-- Until now the app had exactly one user. A guest is a second, narrow role: it
-- can read one goal and its movements, and record income or expenses against
-- it, nothing else. The money is still the owner's, so every row the guest
-- writes carries the owner's `user_id` and lands in the owner's ledger and
-- dashboard like any other movement.
--
-- The guest never chooses an account or a category. Both are fixed by the
-- owner when sharing: the account is one that represents the owner's money held
-- by the guest ("En manos de <nombre>"), so a purchase paid from the guest's
-- bank never moves the balance of an account the guest never touched. Where the
-- guest paid from is free text in `payment_method`.
--
-- RLS is the real boundary. The guest holds a JWT and the anon key, so it can
-- call PostgREST directly; the middleware only shapes the UI. The guest gets
-- select and insert policies and no update or delete policy at all.
--
-- The guest is identified by the email in the JWT, the same identity the
-- middleware already gates on for the owner. Google only issues verified
-- addresses and signups stay disabled, so the owner creates the guest's auth
-- user by hand before sharing.

-- ---------------------------------------------------------------------------
-- goal_shares
-- ---------------------------------------------------------------------------

create table public.goal_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.savings_goals (id) on delete cascade,
  member_email text not null,
  member_name text not null,
  account_id uuid not null references public.accounts (id) on delete restrict,
  expense_category_id uuid not null references public.categories (id) on delete restrict,
  income_category_id uuid not null references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint goal_shares_email_normalised
    check (member_email = lower(btrim(member_email)) and position('@' in member_email) > 1),
  constraint goal_shares_name_not_blank check (length(btrim(member_name)) > 0),
  constraint goal_shares_unique_member unique (goal_id, member_email)
);

create index goal_shares_member_email_idx on public.goal_shares (member_email);

comment on table public.goal_shares is
  'Grants a guest, identified by email, read access to one goal and the right to record movements on it.';

alter table public.goal_shares enable row level security;

create policy goal_shares_owner_all on public.goal_shares
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy goal_shares_member_select on public.goal_shares
  for select to authenticated
  using (member_email = (select lower(auth.jwt() ->> 'email')));

-- ---------------------------------------------------------------------------
-- transactions: where the guest paid from, and who wrote the row
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column payment_method text,
  add column created_by_email text,
  add column created_by_name text,
  add constraint transactions_payment_method_length
    check (payment_method is null or length(btrim(payment_method)) between 1 and 60);

comment on column public.transactions.payment_method is
  'Where a guest paid from (a bank, cash). Free text; the account is fixed by the share.';
comment on column public.transactions.created_by_email is
  'Email of the session that inserted the row, set by trigger. Null for the spreadsheet import.';
comment on column public.transactions.created_by_name is
  'Display name of the author at insert time, set by trigger.';

update public.transactions t
set created_by_email = lower(u.email),
    created_by_name = coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
from auth.users u
where u.id = t.user_id
  and t.source = 'app';

create or replace function public.set_transaction_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by_email := old.created_by_email;
    new.created_by_name := old.created_by_name;
    return new;
  end if;

  new.created_by_email := lower(auth.jwt() ->> 'email');
  new.created_by_name := null;

  if new.created_by_email is null then
    return new;
  end if;

  new.created_by_name := (
    select s.member_name
    from public.goal_shares s
    where s.goal_id = new.goal_id
      and s.member_email = new.created_by_email
  );

  if new.created_by_name is null then
    new.created_by_name := (
      select coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
      from auth.users u
      where u.id = auth.uid()
        and u.id = new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.set_transaction_author is
  'Stamps the author from the JWT, ignoring whatever the client sent, and freezes it on update. '
  'A guest is named by the share the owner created, not by its own editable user metadata.';

create trigger transactions_set_author
  before insert or update on public.transactions
  for each row execute function public.set_transaction_author();

-- ---------------------------------------------------------------------------
-- Guest policies. Permissive, so they widen the owner policies rather than
-- replace them.
-- ---------------------------------------------------------------------------

create policy savings_goals_member_select on public.savings_goals
  for select to authenticated
  using (
    id in (
      select s.goal_id
      from public.goal_shares s
      where s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  );

create policy transactions_member_select on public.transactions
  for select to authenticated
  using (
    goal_id in (
      select s.goal_id
      from public.goal_shares s
      where s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  );

create policy transactions_member_insert on public.transactions
  for insert to authenticated
  with check (
    direction in ('income', 'expense')
    and status = 'paid'
    and source = 'app'
    and source_row_hash is null
    and exists (
      select 1
      from public.goal_shares s
      where s.goal_id = transactions.goal_id
        and s.member_email = (select lower(auth.jwt() ->> 'email'))
        and s.user_id = transactions.user_id
        and s.account_id = transactions.account_id
        and transactions.category_id = case transactions.direction
          when 'expense' then s.expense_category_id
          when 'income' then s.income_category_id
        end
    )
  );

-- ---------------------------------------------------------------------------
-- v_goal_progress: income charged to a goal is money entering it
-- ---------------------------------------------------------------------------

create or replace view public.v_goal_progress
with (security_invoker = true) as
with movements as (
  select
    t.user_id,
    t.goal_id,
    coalesce(sum(t.amount_usd) filter (where t.direction in ('transfer', 'income')), 0)
      as contributed_usd,
    coalesce(sum(t.amount_usd) filter (where t.direction = 'expense'), 0) as spent_usd,
    max(t.occurred_on) as last_movement_on
  from public.transactions t
  where t.goal_id is not null
    and t.status = 'paid'
  group by t.user_id, t.goal_id
)
select
  g.user_id,
  g.id as goal_id,
  g.name,
  g.status,
  g.target_amount_usd,
  g.target_date,
  g.account_id,
  coalesce(m.contributed_usd, 0) as contributed_usd,
  coalesce(m.spent_usd, 0) as spent_usd,
  coalesce(m.contributed_usd, 0) - coalesce(m.spent_usd, 0) as current_amount_usd,
  m.last_movement_on,
  case
    when g.target_amount_usd > 0
      then round(
        (coalesce(m.contributed_usd, 0) - coalesce(m.spent_usd, 0)) / g.target_amount_usd,
        4
      )
  end as progress_ratio
from public.savings_goals g
left join movements m on m.goal_id = g.id and m.user_id = g.user_id;

-- ---------------------------------------------------------------------------
-- handle_new_user: only the first user gets the starter data
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id <> new.id) then
    perform public.seed_default_data(new.id);
  end if;
  return new;
end;
$$;

comment on function public.handle_new_user is
  'Seeds the starter accounts, categories and goals for the owner only. Guests own no data.';
