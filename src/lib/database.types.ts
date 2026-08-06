/**
 * Types for the `public` schema, mirroring `supabase/migrations/`.
 *
 * Hand-written so the app compiles before the Supabase project is linked.
 * Once it is, `pnpm db:types` regenerates this file from the live schema and
 * that generated output becomes the source of truth.
 *
 * Note: Postgres `numeric` columns arrive over PostgREST as JSON numbers here,
 * but PostgREST may serialise large values as strings. Always normalise with
 * `Number()` before doing arithmetic.
 */

export type AccountType =
  | 'cash'
  | 'debit'
  | 'credit_card'
  | 'crypto'
  | 'platform'
  | 'loan';

export type CategoryKind = 'income' | 'expense';

export type TxDirection = 'income' | 'expense' | 'transfer';

export type TxStatus = 'paid' | 'pending';

export type GoalStatus = 'active' | 'completed' | 'abandoned';

/** Currencies the original amount may have been paid in, besides USD. */
export type LocalCurrency = 'VES' | 'COP';

type AccountRow = {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  is_savings: boolean;
  credit_limit_usd: number | null;
  statement_day: number | null;
  opening_balance_usd: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type SavingsGoalRow = {
  id: string;
  user_id: string;
  name: string;
  target_amount_usd: number | null;
  target_date: string | null;
  status: GoalStatus;
  account_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type TransactionRow = {
  id: string;
  user_id: string;
  occurred_on: string;
  direction: TxDirection;
  category_id: string | null;
  account_id: string;
  to_account_id: string | null;
  amount_usd: number;
  amount_local: number | null;
  local_currency: LocalCurrency | null;
  fx_rate_local_usd: number | null;
  status: TxStatus;
  goal_id: string | null;
  tags: string[];
  notes: string | null;
  source: string;
  source_row_hash: string | null;
  created_at: string;
  updated_at: string;
}

type BudgetRow = {
  id: string;
  user_id: string;
  category_id: string;
  period_month: string;
  amount_usd: number;
  created_at: string;
  updated_at: string;
}

type FxRateRow = {
  user_id: string;
  currency: LocalCurrency;
  rate_date: string;
  units_per_usd: number;
  source: string | null;
  created_at: string;
}

type AccountBalanceSnapshotRow = {
  id: string;
  user_id: string;
  account_id: string;
  captured_at: string;
  captured_on: string;
  balance_usd: number;
  balance_local: number | null;
  local_currency: LocalCurrency | null;
  fx_rate_local_usd: number | null;
  notes: string | null;
  created_at: string;
}

type BudgetTemplateRow = {
  id: string;
  user_id: string;
  category_id: string;
  effective_from: string;
  amount_usd: number;
  created_at: string;
  updated_at: string;
}

type GoalAllocationRow = {
  id: string;
  user_id: string;
  goal_id: string;
  account_id: string;
  amount_usd: number;
  created_at: string;
  updated_at: string;
}

type MonthlySummaryRow = {
  user_id: string;
  period_month: string;
  income_usd: number;
  expense_usd: number;
  pending_expense_usd: number;
  saved_usd: number;
  tx_count: number;
  net_usd: number;
  savings_rate: number | null;
}

type CategorySpendRow = {
  user_id: string;
  period_month: string;
  category_id: string;
  category_name: string;
  parent_name: string | null;
  color: string | null;
  total_usd: number;
  tx_count: number;
}

/** Return shape of `v_account_monthly_spend`, one row per account and month. */
type AccountMonthlySpendRow = {
  user_id: string;
  period_month: string;
  account_id: string;
  account_name: string;
  account_type: AccountType;
  total_usd: number;
  tx_count: number;
}

/** Return shape of `v_tag_monthly_spend`, one row per tag and month. */
type TagMonthlySpendRow = {
  user_id: string;
  period_month: string;
  tag: string;
  total_usd: number;
  tx_count: number;
}

type AccountBalanceRow = {
  user_id: string;
  account_id: string;
  name: string;
  type: AccountType;
  currency: string;
  is_savings: boolean;
  is_active: boolean;
  credit_limit_usd: number | null;
  sort_order: number;
  balance_usd: number;
}

type DeclaredBalanceRow = {
  user_id: string;
  account_id: string;
  name: string;
  type: AccountType;
  currency: string;
  is_savings: boolean;
  is_active: boolean;
  sort_order: number;
  is_asset: boolean;
  declared_usd: number | null;
  declared_local: number | null;
  local_currency: LocalCurrency | null;
  fx_rate_local_usd: number | null;
  declared_at: string | null;
  declared_on: string | null;
  movement_since_usd: number;
  current_usd: number | null;
  computed_usd: number;
  unrecorded_usd: number | null;
}

/** Return shape of `v_account_ledger`, one row per leg of every paid movement. */
type AccountLedgerRow = {
  user_id: string;
  account_id: string;
  occurred_on: string;
  delta: number;
  recorded_at: string;
}

type NetWorthRow = {
  user_id: string;
  assets_usd: number;
  debt_usd: number;
  net_usd: number;
  accounts_pending: number;
  accounts_total: number;
  last_declared_at: string | null;
}

/** Return shape of the `budget_vs_actual(date)` function. */
type BudgetVsActualRow = {
  category_id: string;
  category_name: string;
  parent_name: string | null;
  color: string | null;
  budget_usd: number;
  template_usd: number | null;
  is_override: boolean;
  spent_usd: number;
  remaining_usd: number;
  consumed_ratio: number;
}

type GoalProgressRow = {
  user_id: string;
  goal_id: string;
  name: string;
  status: GoalStatus;
  target_amount_usd: number | null;
  target_date: string | null;
  account_id: string | null;
  contributed_usd: number;
  spent_usd: number;
  current_amount_usd: number;
  last_movement_on: string | null;
  progress_ratio: number | null;
}

/** Columns the database fills in itself and that clients must never send. */
type Generated = 'id' | 'created_at' | 'updated_at';

/** Keys whose column accepts NULL, and which may therefore be omitted. */
type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T];

/**
 * Insert shape: generated columns, nullable columns and the listed defaulted
 * columns are optional; everything else is required, matching what Postgres
 * will actually accept.
 */
type Insert<T, Defaulted extends keyof T = never> = Omit<
  T,
  Extract<Generated | NullableKeys<T> | Defaulted, keyof T>
> &
  Partial<Pick<T, Extract<Generated | NullableKeys<T> | Defaulted, keyof T>>>;

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: AccountRow;
        Insert: Insert<
          AccountRow,
          'currency' | 'is_savings' | 'opening_balance_usd' | 'is_active' | 'sort_order'
        >;
        Update: Partial<AccountRow>;
        Relationships: [];
      };
      categories: {
        Row: CategoryRow;
        Insert: Insert<CategoryRow, 'sort_order' | 'is_active'>;
        Update: Partial<CategoryRow>;
        Relationships: [];
      };
      savings_goals: {
        Row: SavingsGoalRow;
        Insert: Insert<SavingsGoalRow, 'status'>;
        Update: Partial<SavingsGoalRow>;
        Relationships: [];
      };
      transactions: {
        Row: TransactionRow;
        Insert: Insert<TransactionRow, 'status' | 'tags' | 'source'>;
        Update: Partial<TransactionRow>;
        Relationships: [];
      };
      budgets: {
        Row: BudgetRow;
        Insert: Insert<BudgetRow>;
        Update: Partial<BudgetRow>;
        Relationships: [];
      };
      fx_rates: {
        Row: FxRateRow;
        Insert: Insert<FxRateRow>;
        Update: Partial<FxRateRow>;
        Relationships: [];
      };
      account_balances: {
        Row: AccountBalanceSnapshotRow;
        Insert: Insert<AccountBalanceSnapshotRow, 'captured_at' | 'captured_on'>;
        Update: Partial<AccountBalanceSnapshotRow>;
        Relationships: [];
      };
      budget_templates: {
        Row: BudgetTemplateRow;
        Insert: Insert<BudgetTemplateRow>;
        Update: Partial<BudgetTemplateRow>;
        Relationships: [];
      };
      goal_allocations: {
        Row: GoalAllocationRow;
        Insert: Insert<GoalAllocationRow>;
        Update: Partial<GoalAllocationRow>;
        Relationships: [];
      };
    };
    Views: {
      v_monthly_summary: { Row: MonthlySummaryRow; Relationships: [] };
      v_category_spend: { Row: CategorySpendRow; Relationships: [] };
      v_account_monthly_spend: { Row: AccountMonthlySpendRow; Relationships: [] };
      v_tag_monthly_spend: { Row: TagMonthlySpendRow; Relationships: [] };
      v_account_balances: { Row: AccountBalanceRow; Relationships: [] };
      v_account_ledger: { Row: AccountLedgerRow; Relationships: [] };
      v_declared_balances: { Row: DeclaredBalanceRow; Relationships: [] };
      v_net_worth: { Row: NetWorthRow; Relationships: [] };
      v_goal_progress: { Row: GoalProgressRow; Relationships: [] };
    };
    Functions: {
      budget_vs_actual: {
        Args: { p_month: string };
        Returns: BudgetVsActualRow[];
      };
    };
    Enums: {
      account_type: AccountType;
      category_kind: CategoryKind;
      tx_direction: TxDirection;
      tx_status: TxStatus;
      goal_status: GoalStatus;
    };
    CompositeTypes: Record<never, never>;
  };
}
