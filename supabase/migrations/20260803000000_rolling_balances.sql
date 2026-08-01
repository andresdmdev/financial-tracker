-- Declared balances that roll forward with the transactions recorded after them.
--
-- Until now `v_net_worth` summed `declared_usd` and nothing else, so the headline
-- figure froze the moment it was declared: ten expenses later it still showed the
-- old number. The manual snapshot has to keep winning — a balance derived from a
-- single-entry ledger is not a balance — but it should carry forward instead of
-- standing still.
--
--   current_usd = latest declared balance + sum of the legs dated after it
--
-- Strictly after: declaring "I have $X today" describes that day's close, so the
-- same day's movements are already inside the figure and adding them again would
-- count them twice.
--
-- An account never declared still reports null. Falling back to the derived
-- balance would reintroduce exactly the lie this table exists to avoid.

-- ---------------------------------------------------------------------------
-- The date a snapshot refers to
-- ---------------------------------------------------------------------------

alter table public.account_balances
  add column captured_on date;

update public.account_balances
set captured_on = (captured_at at time zone 'utc')::date
where captured_on is null;

alter table public.account_balances
  alter column captured_on set not null,
  alter column captured_on set default (now() at time zone 'utc')::date;

comment on column public.account_balances.captured_on is
  'Calendar day the snapshot describes, sent by the client in its own timezone. '
  'Separate from captured_at, which only breaks ties between two declarations on '
  'the same day: casting captured_at would shift the snapshot by a day for anyone '
  'declaring in the evening west of UTC.';

create index account_balances_captured_on_idx
  on public.account_balances (user_id, account_id, captured_on desc);

-- ---------------------------------------------------------------------------
-- Rebuild order: dependents first
-- ---------------------------------------------------------------------------

drop view public.v_net_worth;
drop view public.v_declared_balances;

-- ---------------------------------------------------------------------------
-- v_account_ledger — the accounting legs, dated
-- ---------------------------------------------------------------------------

create view public.v_account_ledger
with (security_invoker = true) as
select
  t.user_id,
  t.account_id,
  t.occurred_on,
  case when t.direction = 'income' then t.amount_usd else -t.amount_usd end as delta
from public.transactions t
where t.status = 'paid'
union all
select
  t.user_id,
  t.to_account_id as account_id,
  t.occurred_on,
  t.amount_usd as delta
from public.transactions t
where t.status = 'paid'
  and t.direction = 'transfer';

comment on view public.v_account_ledger is
  'One row per movement of money in or out of an account, with the destination '
  'leg of every transfer. Previously buried in a CTE inside v_account_balances; '
  'exposed so a balance can be summed from an arbitrary date onwards.';

-- ---------------------------------------------------------------------------
-- v_account_balances — same result, now reading from the ledger
-- ---------------------------------------------------------------------------

create or replace view public.v_account_balances
with (security_invoker = true) as
select
  a.user_id,
  a.id as account_id,
  a.name,
  a.type,
  a.currency,
  a.is_savings,
  a.is_active,
  a.credit_limit_usd,
  a.sort_order,
  a.opening_balance_usd + coalesce(sum(legs.delta), 0) as balance_usd
from public.accounts a
left join public.v_account_ledger legs
  on legs.account_id = a.id and legs.user_id = a.user_id
group by
  a.user_id,
  a.id,
  a.name,
  a.type,
  a.currency,
  a.is_savings,
  a.is_active,
  a.credit_limit_usd,
  a.sort_order,
  a.opening_balance_usd;

-- ---------------------------------------------------------------------------
-- v_declared_balances — the snapshot, rolled forward
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
  latest.captured_on as declared_on,
  coalesce(since.delta, 0) as movement_since_usd,
  case
    when latest.balance_usd is null then null
    else latest.balance_usd + coalesce(since.delta, 0)
  end as current_usd,
  calc.balance_usd as computed_usd,
  case
    when latest.balance_usd is null then null
    else latest.balance_usd - calc.balance_usd
  end as unrecorded_usd
from public.accounts a
join public.v_account_balances calc
  on calc.account_id = a.id and calc.user_id = a.user_id
left join lateral (
  select
    b.balance_usd,
    b.balance_local,
    b.local_currency,
    b.fx_rate_local_usd,
    b.captured_at,
    b.captured_on
  from public.account_balances b
  where b.account_id = a.id
  order by b.captured_at desc
  limit 1
) latest on true
left join lateral (
  select coalesce(sum(l.delta), 0) as delta
  from public.v_account_ledger l
  where l.account_id = a.id
    and l.user_id = a.user_id
    and l.occurred_on > latest.captured_on
) since on true;

comment on view public.v_declared_balances is
  'Latest declared balance per account, rolled forward by every movement dated '
  'strictly after it. current_usd is what the account holds today; declared_usd '
  'is the last figure the user vouched for. computed_usd and unrecorded_usd are '
  'kept for auditing the pre-declaration history and are not shown in the app.';

comment on column public.v_declared_balances.movement_since_usd is
  'Net of the legs dated after declared_on. Zero when nothing moved since, and '
  'zero for an account that was never declared.';

-- ---------------------------------------------------------------------------
-- v_net_worth — now over the rolled-forward figure
-- ---------------------------------------------------------------------------

create view public.v_net_worth
with (security_invoker = true) as
select
  user_id,
  coalesce(sum(current_usd) filter (where is_asset), 0) as assets_usd,
  coalesce(sum(-current_usd) filter (where not is_asset), 0) as debt_usd,
  coalesce(sum(current_usd), 0) as net_usd,
  count(*) filter (where declared_usd is null) as accounts_pending,
  count(*) as accounts_total,
  max(declared_at) as last_declared_at
from public.v_declared_balances
where is_active
group by user_id;

comment on view public.v_net_worth is
  'Total money held: declared balances carried forward by later transactions. '
  'accounts_pending counts the active accounts never declared, which is how '
  'stale the figure is allowed to look.';

grant select on public.v_account_ledger to authenticated;
grant select on public.v_declared_balances, public.v_net_worth to authenticated;
