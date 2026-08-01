-- Picks the snapshot in force by the day it describes, not by the instant it was
-- saved.
--
-- `v_declared_balances` ordered the lateral by `captured_at desc`, which is wrong
-- as soon as `captured_on` can differ from it. Two cases break:
--
--   * a backdated correction ("as of last Monday I actually had $X") would
--     override today's snapshot, because it was saved later.
--   * two declarations written inside one transaction share `now()`, so
--     `captured_at` ties and the winner is whichever row the planner returns.
--
-- `captured_on desc, captured_at desc` reads as "the most recent day, and among
-- declarations for that same day the one written last", which is the intent.

create or replace view public.v_declared_balances
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
  order by b.captured_on desc, b.captured_at desc
  limit 1
) latest on true
left join lateral (
  select coalesce(sum(l.delta), 0) as delta
  from public.v_account_ledger l
  where l.account_id = a.id
    and l.user_id = a.user_id
    and l.occurred_on > latest.captured_on
) since on true;
