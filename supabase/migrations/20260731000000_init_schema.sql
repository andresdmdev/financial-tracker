-- Core schema for the personal finance tracker.
--
-- Design notes that the previous spreadsheet could not express:
--   * amounts are stored positive; `direction` carries the sign semantics
--   * USD is canonical, VES is kept only as the original captured amount
--   * moving money into savings is a `transfer`, never an `expense`
--   * categories and accounts are rows, not enums, so new ones need no migration

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.account_type as enum (
  'cash',
  'debit',
  'credit_card',
  'crypto',
  'platform',
  'loan'
);

create type public.category_kind as enum ('income', 'expense');

create type public.tx_direction as enum ('income', 'expense', 'transfer');

create type public.tx_status as enum ('paid', 'pending');

create type public.goal_status as enum ('active', 'completed', 'abandoned');

-- ---------------------------------------------------------------------------
-- Shared trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Stamps updated_at on every UPDATE so the column cannot drift from reality.';

-- ---------------------------------------------------------------------------
-- accounts — replaces the spreadsheet MEDIUM column
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type public.account_type not null,
  currency text not null default 'USD',
  is_savings boolean not null default false,
  credit_limit_usd numeric(14, 2),
  statement_day smallint,
  opening_balance_usd numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_name_not_blank check (length(btrim(name)) > 0),
  constraint accounts_currency_supported check (currency in ('USD', 'VES')),
  constraint accounts_statement_day_valid
    check (statement_day is null or statement_day between 1 and 31),
  constraint accounts_credit_limit_positive
    check (credit_limit_usd is null or credit_limit_usd > 0)
);

create unique index accounts_user_name_key
  on public.accounts (user_id, lower(name));

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

comment on table public.accounts is
  'Where money physically sits: cards, cash, crypto and payout platforms.';
comment on column public.accounts.is_savings is
  'Marks an account that holds money set aside for savings goals.';

-- ---------------------------------------------------------------------------
-- categories — replaces the spreadsheet CATEGORY enum
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind public.category_kind not null,
  parent_id uuid references public.categories (id) on delete set null,
  color text,
  icon text,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id)
);

create unique index categories_user_name_key
  on public.categories (user_id, lower(name));

create index categories_parent_idx on public.categories (parent_id);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

comment on table public.categories is
  'Spending and income categories. A row, not an enum, so adding one is data.';

-- ---------------------------------------------------------------------------
-- savings_goals — replaces the UPMacbook / Carro / Moto / Apartamento categories
-- ---------------------------------------------------------------------------

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_amount_usd numeric(14, 2),
  target_date date,
  status public.goal_status not null default 'active',
  account_id uuid references public.accounts (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_goals_name_not_blank check (length(btrim(name)) > 0),
  constraint savings_goals_target_positive
    check (target_amount_usd is null or target_amount_usd > 0)
);

create unique index savings_goals_user_name_key
  on public.savings_goals (user_id, lower(name));

create trigger savings_goals_set_updated_at
  before update on public.savings_goals
  for each row execute function public.set_updated_at();

comment on table public.savings_goals is
  'Sinking funds: money set aside for a specific future purchase, not a debt.';

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  occurred_on date not null,
  direction public.tx_direction not null,
  category_id uuid references public.categories (id) on delete restrict,
  account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid references public.accounts (id) on delete restrict,
  amount_usd numeric(14, 2) not null,
  amount_local numeric(18, 2),
  local_currency char(3),
  fx_rate_local_usd numeric(18, 6),
  status public.tx_status not null default 'paid',
  goal_id uuid references public.savings_goals (id) on delete set null,
  tags text[] not null default '{}',
  notes text,
  source text not null default 'app',
  source_row_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_amount_positive check (amount_usd > 0),
  constraint transactions_local_amount_positive
    check (amount_local is null or amount_local > 0),
  constraint transactions_transfer_needs_destination
    check (direction <> 'transfer' or to_account_id is not null),
  constraint transactions_non_transfer_needs_category
    check (direction = 'transfer' or category_id is not null),
  constraint transactions_transfer_has_no_category
    check (direction <> 'transfer' or category_id is null),
  constraint transactions_destination_differs
    check (to_account_id is null or to_account_id <> account_id),
  constraint transactions_destination_only_on_transfer
    check (direction = 'transfer' or to_account_id is null),
  constraint transactions_local_currency_known
    check (local_currency is null or local_currency in ('VES', 'COP')),
  constraint transactions_local_is_complete
    check (num_nulls(amount_local, local_currency, fx_rate_local_usd) in (0, 3)),
  constraint transactions_local_rate_positive
    check (fx_rate_local_usd is null or fx_rate_local_usd > 0),
  constraint transactions_source_known check (source in ('app', 'sheets-import'))
);

create unique index transactions_source_row_hash_key
  on public.transactions (user_id, source_row_hash)
  where source_row_hash is not null;

create index transactions_user_date_idx
  on public.transactions (user_id, occurred_on desc);

create index transactions_user_category_date_idx
  on public.transactions (user_id, category_id, occurred_on desc);

create index transactions_user_account_idx
  on public.transactions (user_id, account_id);

create index transactions_user_goal_idx
  on public.transactions (user_id, goal_id)
  where goal_id is not null;

create index transactions_tags_idx on public.transactions using gin (tags);

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

comment on table public.transactions is
  'Every movement of money. Amounts are always positive; direction carries sign.';
comment on column public.transactions.amount_usd is
  'Canonical amount. All reporting is in USD.';
comment on column public.transactions.amount_local is
  'Original amount as paid, when it was not paid in USD. Never used for reporting.';
comment on column public.transactions.local_currency is
  'Currency of amount_local. The spreadsheet mixed VES and COP, so it must be explicit.';
comment on column public.transactions.tags is
  'Orthogonal labels such as gastos-hormiga, which are not categories.';
comment on column public.transactions.source_row_hash is
  'Hash of the originating spreadsheet row; makes the import idempotent.';

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  period_month date not null,
  amount_usd numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_amount_positive check (amount_usd > 0),
  constraint budgets_period_is_first_of_month
    check (period_month = date_trunc('month', period_month)::date),
  constraint budgets_unique_per_period unique (user_id, category_id, period_month)
);

create index budgets_user_period_idx on public.budgets (user_id, period_month desc);

create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

comment on table public.budgets is
  'Monthly spending ceiling per category, keyed by the first day of the month.';

-- ---------------------------------------------------------------------------
-- fx_rates
-- ---------------------------------------------------------------------------

create table public.fx_rates (
  user_id uuid not null references auth.users (id) on delete cascade,
  currency char(3) not null,
  rate_date date not null,
  units_per_usd numeric(18, 6) not null,
  source text,
  created_at timestamptz not null default now(),
  primary key (user_id, currency, rate_date),
  constraint fx_rates_currency_known check (currency in ('VES', 'COP')),
  constraint fx_rates_positive check (units_per_usd > 0)
);

comment on table public.fx_rates is
  'Daily rate per currency, used to prefill new transactions. Deliberately not populated '
  'by the spreadsheet import: those historical rates were inconsistent enough that '
  'averaging them would corrupt every future conversion.';
