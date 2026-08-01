-- Reporting views for the dashboard.
--
-- Aggregation happens here, not in the browser: the app should never download a
-- year of transactions just to add them up.
--
-- Every view is declared `security_invoker = true` so the caller's RLS policies
-- apply. Without it a view runs with its owner's rights and silently bypasses
-- row level security.
--
-- Two rules hold across all of them:
--   * transfers are never income or expense — they move money between own accounts
--   * only `paid` rows count as realised; `pending` is reported separately

-- ---------------------------------------------------------------------------
-- v_monthly_summary
-- ---------------------------------------------------------------------------

create view public.v_monthly_summary
with (security_invoker = true) as
with base as (
  select
    t.user_id,
    date_trunc('month', t.occurred_on)::date as period_month,
    coalesce(
      sum(t.amount_usd) filter (where t.direction = 'income' and t.status = 'paid'), 0
    ) as income_usd,
    coalesce(
      sum(t.amount_usd) filter (where t.direction = 'expense' and t.status = 'paid'), 0
    ) as expense_usd,
    coalesce(
      sum(t.amount_usd) filter (where t.direction = 'expense' and t.status = 'pending'), 0
    ) as pending_expense_usd,
    coalesce(
      sum(t.amount_usd) filter (
        where t.direction = 'transfer' and t.status = 'paid' and dest.is_savings
      ), 0
    ) as saved_usd,
    count(*) filter (where t.status = 'paid') as tx_count
  from public.transactions t
  left join public.accounts dest on dest.id = t.to_account_id
  group by t.user_id, date_trunc('month', t.occurred_on)::date
)
select
  base.user_id,
  base.period_month,
  base.income_usd,
  base.expense_usd,
  base.pending_expense_usd,
  base.saved_usd,
  base.tx_count,
  base.income_usd - base.expense_usd as net_usd,
  case
    when base.income_usd > 0
      then round((base.income_usd - base.expense_usd) / base.income_usd, 4)
  end as savings_rate
from base;

comment on view public.v_monthly_summary is
  'Realised income, expense, net and savings rate per month, plus pending expense.';

-- ---------------------------------------------------------------------------
-- v_category_spend
-- ---------------------------------------------------------------------------

create view public.v_category_spend
with (security_invoker = true) as
select
  t.user_id,
  date_trunc('month', t.occurred_on)::date as period_month,
  c.id as category_id,
  c.name as category_name,
  parent.name as parent_name,
  c.color,
  sum(t.amount_usd) as total_usd,
  count(*) as tx_count
from public.transactions t
join public.categories c on c.id = t.category_id
left join public.categories parent on parent.id = c.parent_id
where t.direction = 'expense'
  and t.status = 'paid'
group by
  t.user_id,
  date_trunc('month', t.occurred_on)::date,
  c.id,
  c.name,
  parent.name,
  c.color;

comment on view public.v_category_spend is
  'Realised expense per category and month. Transfers into savings are excluded.';

-- ---------------------------------------------------------------------------
-- v_account_balances
-- ---------------------------------------------------------------------------

create view public.v_account_balances
with (security_invoker = true) as
with legs as (
  select
    t.user_id,
    t.account_id,
    case when t.direction = 'income' then t.amount_usd else -t.amount_usd end as delta
  from public.transactions t
  where t.status = 'paid'
  union all
  select
    t.user_id,
    t.to_account_id as account_id,
    t.amount_usd as delta
  from public.transactions t
  where t.status = 'paid'
    and t.direction = 'transfer'
)
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
left join legs on legs.account_id = a.id and legs.user_id = a.user_id
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

comment on view public.v_account_balances is
  'Current balance per account. Negative on a credit card means outstanding debt.';

-- ---------------------------------------------------------------------------
-- v_budget_vs_actual
-- ---------------------------------------------------------------------------

create view public.v_budget_vs_actual
with (security_invoker = true) as
select
  b.user_id,
  b.period_month,
  b.category_id,
  c.name as category_name,
  c.color,
  b.amount_usd as budget_usd,
  coalesce(spend.total_usd, 0) as spent_usd,
  b.amount_usd - coalesce(spend.total_usd, 0) as remaining_usd,
  round(coalesce(spend.total_usd, 0) / b.amount_usd, 4) as consumed_ratio
from public.budgets b
join public.categories c on c.id = b.category_id
left join public.v_category_spend spend
  on spend.user_id = b.user_id
  and spend.category_id = b.category_id
  and spend.period_month = b.period_month;

comment on view public.v_budget_vs_actual is
  'Budget against realised spend per category and month, with consumed ratio.';

-- ---------------------------------------------------------------------------
-- v_goal_progress
-- ---------------------------------------------------------------------------

create view public.v_goal_progress
with (security_invoker = true) as
with movements as (
  select
    t.user_id,
    t.goal_id,
    coalesce(sum(t.amount_usd) filter (where t.direction = 'transfer'), 0) as contributed_usd,
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

comment on view public.v_goal_progress is
  'Contributed, spent and remaining amount per savings goal, with progress ratio.';

grant select on
  public.v_monthly_summary,
  public.v_category_spend,
  public.v_account_balances,
  public.v_budget_vs_actual,
  public.v_goal_progress
to authenticated;
