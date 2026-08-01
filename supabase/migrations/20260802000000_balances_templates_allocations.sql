-- Declared balances, recurring budget templates and per-goal money allocation.
--
-- Three gaps this closes, all of them consequences of the spreadsheet being a
-- single-entry ledger:
--
--   * `v_account_balances` derives a balance from transactions alone, which is
--     wrong whenever a movement between own accounts was never written down.
--     `account_balances` records what the user actually observes, and the
--     difference against the derived figure is surfaced rather than hidden.
--   * budgets had to be recreated every month. A template carries an amount
--     forward indefinitely; `budgets` becomes the single-month exception.
--   * a savings goal knew how much was accumulated but not where it sits.

-- ---------------------------------------------------------------------------
-- account_balances — the user's own observation of what an account holds
-- ---------------------------------------------------------------------------

create table public.account_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  captured_at timestamptz not null default now(),
  balance_usd numeric(14, 2) not null,
  balance_local numeric(18, 2),
  local_currency char(3),
  fx_rate_local_usd numeric(18, 6),
  notes text,
  created_at timestamptz not null default now(),
  constraint account_balances_local_currency_known
    check (local_currency is null or local_currency in ('VES', 'COP')),
  constraint account_balances_local_is_complete
    check (num_nulls(balance_local, local_currency, fx_rate_local_usd) in (0, 3)),
  constraint account_balances_local_not_negative
    check (balance_local is null or balance_local >= 0),
  constraint account_balances_rate_positive
    check (fx_rate_local_usd is null or fx_rate_local_usd > 0)
);

create index account_balances_latest_idx
  on public.account_balances (user_id, account_id, captured_at desc);

comment on table public.account_balances is
  'Point-in-time balance declared by the user. Append-only history: the newest '
  'row per account is the current truth, older rows are kept for the trend.';
comment on column public.account_balances.balance_usd is
  'Canonical value. Negative on a credit card or loan, meaning outstanding debt.';
comment on column public.account_balances.balance_local is
  'Amount as held, when the account is not denominated in USD. Debit holds '
  'bolivares, so its balance is captured in VES together with the rate used.';

-- ---------------------------------------------------------------------------
-- budget_templates — a budget that carries forward until it is changed
-- ---------------------------------------------------------------------------

create table public.budget_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  effective_from date not null,
  amount_usd numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_templates_amount_positive check (amount_usd > 0),
  constraint budget_templates_period_is_first_of_month
    check (effective_from = date_trunc('month', effective_from)::date),
  constraint budget_templates_unique_per_start
    unique (user_id, category_id, effective_from)
);

create index budget_templates_lookup_idx
  on public.budget_templates (user_id, category_id, effective_from desc);

create trigger budget_templates_set_updated_at
  before update on public.budget_templates
  for each row execute function public.set_updated_at();

comment on table public.budget_templates is
  'Standing budget per category, applying from effective_from onwards until a '
  'later row supersedes it. Editing "from now on" inserts a new row rather than '
  'rewriting the old one, so past months keep the ceiling they were judged by.';

-- ---------------------------------------------------------------------------
-- goal_allocations — where the money saved for a goal is currently parked
-- ---------------------------------------------------------------------------

create table public.goal_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.savings_goals (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  amount_usd numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_allocations_amount_positive check (amount_usd > 0),
  constraint goal_allocations_unique_per_account
    unique (user_id, goal_id, account_id)
);

create index goal_allocations_goal_idx on public.goal_allocations (user_id, goal_id);

create trigger goal_allocations_set_updated_at
  before update on public.goal_allocations
  for each row execute function public.set_updated_at();

comment on table public.goal_allocations is
  'Manual split of a goal accumulated amount across accounts. Deliberately not '
  'derived from transactions: those record where the money came from, not where '
  'it sits today.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.account_balances enable row level security;
alter table public.budget_templates enable row level security;
alter table public.goal_allocations enable row level security;

create policy account_balances_owner_all on public.account_balances
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy budget_templates_owner_all on public.budget_templates
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy goal_allocations_owner_all on public.goal_allocations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Accounts the spreadsheet never had
-- ---------------------------------------------------------------------------

create or replace function public.seed_default_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_savings_account_id uuid;
  v_food_category_id uuid;
begin
  insert into public.accounts (user_id, name, type, currency, is_savings, sort_order)
  values
    (p_user_id, 'Binance', 'crypto', 'USD', false, 10),
    (p_user_id, 'Credit Card', 'credit_card', 'USD', false, 20),
    (p_user_id, 'Debit', 'debit', 'VES', false, 30),
    (p_user_id, 'Cash', 'cash', 'USD', false, 40),
    (p_user_id, 'Deel', 'platform', 'USD', false, 50),
    (p_user_id, 'QuantFury', 'platform', 'USD', false, 60),
    (p_user_id, 'TrustWallet', 'crypto', 'USD', false, 70),
    (p_user_id, 'Ahorros', 'debit', 'USD', true, 80)
  on conflict do nothing;

  select id into v_savings_account_id
  from public.accounts
  where user_id = p_user_id and lower(name) = 'ahorros';

  insert into public.categories (user_id, name, kind, sort_order)
  values
    (p_user_id, 'Comida', 'expense', 10),
    (p_user_id, 'Vivienda', 'expense', 30),
    (p_user_id, 'Deuda', 'expense', 40),
    (p_user_id, 'Ropa', 'expense', 50),
    (p_user_id, 'Tecnología', 'expense', 60),
    (p_user_id, 'Transporte', 'expense', 70),
    (p_user_id, 'Educación', 'expense', 80),
    (p_user_id, 'Inversión', 'expense', 90),
    (p_user_id, 'Salud', 'expense', 100),
    (p_user_id, 'Otros', 'expense', 999),
    (p_user_id, 'Sueldo', 'income', 10)
  on conflict do nothing;

  select id into v_food_category_id
  from public.categories
  where user_id = p_user_id and lower(name) = 'comida';

  insert into public.categories (user_id, name, kind, parent_id, sort_order)
  values (p_user_id, 'Proteína', 'expense', v_food_category_id, 20)
  on conflict do nothing;

  insert into public.savings_goals (user_id, name, account_id)
  values
    (p_user_id, 'Macbook', v_savings_account_id),
    (p_user_id, 'Carro', v_savings_account_id),
    (p_user_id, 'Moto', v_savings_account_id),
    (p_user_id, 'Apartamento', v_savings_account_id)
  on conflict do nothing;
end;
$$;

comment on function public.seed_default_data is
  'Creates the starting accounts, categories and goals for a newly created user.';

-- Backfills the users seeded before QuantFury and TrustWallet existed, and
-- corrects Debit, which holds bolivares rather than dollars.
do $$
declare
  v_user record;
begin
  for v_user in select distinct user_id from public.accounts loop
    insert into public.accounts (user_id, name, type, currency, is_savings, sort_order)
    values
      (v_user.user_id, 'QuantFury', 'platform', 'USD', false, 60),
      (v_user.user_id, 'TrustWallet', 'crypto', 'USD', false, 70)
    on conflict do nothing;

    update public.accounts
    set currency = 'VES', sort_order = 30
    where user_id = v_user.user_id and lower(name) = 'debit';

    update public.accounts
    set sort_order = 80
    where user_id = v_user.user_id and lower(name) = 'ahorros';
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- v_declared_balances — observed balance against the one transactions imply
-- ---------------------------------------------------------------------------

create view public.v_declared_balances
with (security_invoker = true) as
select
  a.user_id,
  a.id as account_id,
  a.name,
  a.type,
  a.currency,
  a.is_savings,
  a.is_active,
  a.sort_order,
  a.type not in ('credit_card', 'loan') as is_asset,
  latest.balance_usd as declared_usd,
  latest.balance_local as declared_local,
  latest.local_currency,
  latest.fx_rate_local_usd,
  latest.captured_at as declared_at,
  calc.balance_usd as computed_usd,
  case
    when latest.balance_usd is null then null
    else latest.balance_usd - calc.balance_usd
  end as unrecorded_usd
from public.accounts a
join public.v_account_balances calc
  on calc.account_id = a.id and calc.user_id = a.user_id
left join lateral (
  select b.balance_usd, b.balance_local, b.local_currency, b.fx_rate_local_usd, b.captured_at
  from public.account_balances b
  where b.account_id = a.id
  order by b.captured_at desc
  limit 1
) latest on true;

comment on view public.v_declared_balances is
  'Latest declared balance per account beside the one the transactions imply. '
  'unrecorded_usd is the money that moved without being written down; it is '
  'reported, never silently corrected.';

-- ---------------------------------------------------------------------------
-- v_net_worth — the headline figure of the dashboard
-- ---------------------------------------------------------------------------

create view public.v_net_worth
with (security_invoker = true) as
select
  user_id,
  coalesce(sum(declared_usd) filter (where is_asset), 0) as assets_usd,
  coalesce(sum(-declared_usd) filter (where not is_asset), 0) as debt_usd,
  coalesce(sum(declared_usd), 0) as net_usd,
  count(*) filter (where declared_usd is null) as accounts_pending,
  count(*) as accounts_total,
  max(declared_at) as last_declared_at
from public.v_declared_balances
where is_active
group by user_id;

comment on view public.v_net_worth is
  'Total money held, from declared balances only. accounts_pending counts the '
  'active accounts never declared, which is how stale the figure is allowed to look.';

-- ---------------------------------------------------------------------------
-- budget_vs_actual — replaces v_budget_vs_actual, which knew nothing of templates
-- ---------------------------------------------------------------------------

drop view public.v_budget_vs_actual;

create function public.budget_vs_actual(p_month date)
returns table (
  category_id uuid,
  category_name text,
  parent_name text,
  color text,
  budget_usd numeric,
  template_usd numeric,
  is_override boolean,
  spent_usd numeric,
  remaining_usd numeric,
  consumed_ratio numeric
)
language sql
stable
as $$
  with period as (
    select date_trunc('month', p_month)::date as month_key
  ),
  template as (
    select distinct on (t.category_id) t.category_id, t.amount_usd
    from public.budget_templates t, period
    where t.effective_from <= period.month_key
    order by t.category_id, t.effective_from desc
  )
  select
    c.id,
    c.name,
    parent.name,
    c.color,
    coalesce(o.amount_usd, template.amount_usd),
    template.amount_usd,
    o.id is not null,
    coalesce(s.total_usd, 0),
    coalesce(o.amount_usd, template.amount_usd) - coalesce(s.total_usd, 0),
    round(coalesce(s.total_usd, 0) / coalesce(o.amount_usd, template.amount_usd), 4)
  from period
  cross join public.categories c
  left join public.categories parent on parent.id = c.parent_id
  left join template on template.category_id = c.id
  left join public.budgets o
    on o.category_id = c.id and o.period_month = period.month_key
  left join public.v_category_spend s
    on s.category_id = c.id and s.period_month = period.month_key
  where c.kind = 'expense'
    and c.is_active
    and coalesce(o.amount_usd, template.amount_usd) is not null
  order by round(coalesce(s.total_usd, 0) / coalesce(o.amount_usd, template.amount_usd), 4) desc;
$$;

comment on function public.budget_vs_actual is
  'Budget against realised spend for one month. The ceiling is the single-month '
  'override when one exists, otherwise the standing template in force that month. '
  'Runs as invoker, so RLS on every underlying table still applies.';

grant execute on function public.budget_vs_actual(date) to authenticated;

grant select on public.v_declared_balances, public.v_net_worth to authenticated;
