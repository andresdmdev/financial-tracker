-- Row Level Security.
--
-- This is a single-user application, but RLS is still the primary access
-- control: the browser holds the anon key and talks to PostgREST directly, so
-- the database — not the frontend — must be what denies access.
--
-- Every policy is scoped `to authenticated`, which leaves the anon role with no
-- reachable rows at all.

alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.savings_goals enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.fx_rates enable row level security;

create policy accounts_owner_all on public.accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy categories_owner_all on public.categories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy savings_goals_owner_all on public.savings_goals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy transactions_owner_all on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy budgets_owner_all on public.budgets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fx_rates_owner_all on public.fx_rates
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
