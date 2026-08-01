-- Counts the movements recorded on the day of a declaration, after it was made.
--
-- Comparing dates alone forces a choice between two wrong answers on the day a
-- balance is declared:
--
--   occurred_on >  captured_on  ignores everything spent later that same day, so
--                               the figure looks frozen until midnight — exactly
--                               the complaint this whole change exists to fix.
--   occurred_on >= captured_on  subtracts what was already spent before the
--                               declaration, which the declared figure already
--                               reflects, so it double-counts.
--
-- The tie is broken with `created_at`: a movement dated today counts only if it
-- was written down after the snapshot was taken. Declaring a balance describes
-- what the account holds at that moment, so anything entered afterwards is new
-- information and anything entered before is already inside the number.
--
-- Backfilling an old transaction still does not move the figure: its
-- `occurred_on` predates `captured_on`, and the snapshot already accounted for it.

create or replace view public.v_account_ledger
with (security_invoker = true) as
select
  t.user_id,
  t.account_id,
  t.occurred_on,
  case when t.direction = 'income' then t.amount_usd else -t.amount_usd end as delta,
  t.created_at as recorded_at
from public.transactions t
where t.status = 'paid'
union all
select
  t.user_id,
  t.to_account_id as account_id,
  t.occurred_on,
  t.amount_usd as delta,
  t.created_at as recorded_at
from public.transactions t
where t.status = 'paid'
  and t.direction = 'transfer';

comment on column public.v_account_ledger.recorded_at is
  'When the row was written, used only to place a movement before or after a '
  'balance declaration made the same day.';

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
    and (
      l.occurred_on > latest.captured_on
      or (l.occurred_on = latest.captured_on and l.recorded_at > latest.captured_at)
    )
) since on true;
