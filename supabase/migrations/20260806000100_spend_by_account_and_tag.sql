-- Realised expense sliced by account and by tag.
--
-- Neither dimension existed: `v_category_spend` groups by category only and
-- `v_monthly_summary` has no breakdown at all, so "how much went on the credit
-- card in March" and "how much do subscriptions cost a month" were unanswerable.
--
-- Both views keep the shape of `v_category_spend` — `direction = 'expense'` and
-- `status = 'paid'`. That filter is what makes the credit card correct: paying
-- the card down is a `transfer`, not spending, and must not appear as a spike in
-- the month it was paid. `v_account_ledger` cannot be used here for exactly that
-- reason: it folds both into a single `delta`.
--
-- Both are deliberately generic. One row per (account, month) and one per
-- (tag, month) answers any future question about a different account or a
-- different label without another migration.

-- ---------------------------------------------------------------------------
-- v_account_monthly_spend
-- ---------------------------------------------------------------------------

create view public.v_account_monthly_spend
with (security_invoker = true) as
select
  t.user_id,
  date_trunc('month', t.occurred_on)::date as period_month,
  a.id as account_id,
  a.name as account_name,
  a.type as account_type,
  sum(t.amount_usd) as total_usd,
  count(*) as tx_count
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.direction = 'expense'
  and t.status = 'paid'
group by
  t.user_id,
  date_trunc('month', t.occurred_on)::date,
  a.id,
  a.name,
  a.type;

comment on view public.v_account_monthly_spend is
  'Realised expense per account and month. Paying a credit card is a transfer, '
  'so it is excluded rather than counted as spending.';

-- ---------------------------------------------------------------------------
-- v_tag_monthly_spend
-- ---------------------------------------------------------------------------

create view public.v_tag_monthly_spend
with (security_invoker = true) as
select
  t.user_id,
  date_trunc('month', t.occurred_on)::date as period_month,
  tag,
  sum(t.amount_usd) as total_usd,
  count(*) as tx_count
from public.transactions t
cross join lateral unnest(t.tags) as tag
where t.direction = 'expense'
  and t.status = 'paid'
group by
  t.user_id,
  date_trunc('month', t.occurred_on)::date,
  tag;

comment on view public.v_tag_monthly_spend is
  'Realised expense per tag and month. A transaction carrying two tags counts '
  'in full under each, so the rows do not sum to the month total.';

grant select on
  public.v_account_monthly_spend,
  public.v_tag_monthly_spend
to authenticated;
