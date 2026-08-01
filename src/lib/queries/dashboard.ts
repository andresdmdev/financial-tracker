import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, LocalCurrency } from '@/lib/database.types';

type Client = SupabaseClient<Database>;

export interface MonthlySummary {
  periodMonth: string;
  incomeUsd: number;
  expenseUsd: number;
  pendingExpenseUsd: number;
  savedUsd: number;
  netUsd: number;
  savingsRate: number | null;
  txCount: number;
}

export interface CategorySpend {
  categoryId: string;
  categoryName: string;
  parentName: string | null;
  totalUsd: number;
  txCount: number;
}

export interface DeclaredBalance {
  accountId: string;
  name: string;
  type: Database['public']['Enums']['account_type'];
  currency: string;
  isSavings: boolean;
  isAsset: boolean;
  declaredUsd: number | null;
  declaredLocal: number | null;
  localCurrency: LocalCurrency | null;
  fxRateLocalUsd: number | null;
  declaredAt: string | null;
  declaredOn: string | null;
  movementSinceUsd: number;
  currentUsd: number | null;
  computedUsd: number;
  unrecordedUsd: number | null;
}

export interface NetWorth {
  assetsUsd: number;
  debtUsd: number;
  netUsd: number;
  accountsPending: number;
  accountsTotal: number;
  lastDeclaredAt: string | null;
}

export interface BudgetVsActual {
  categoryId: string;
  categoryName: string;
  parentName: string | null;
  budgetUsd: number;
  templateUsd: number | null;
  isOverride: boolean;
  spentUsd: number;
  remainingUsd: number;
  consumedRatio: number;
}

export interface CategoryTrendPoint {
  periodMonth: string;
  categoryId: string;
  categoryName: string;
  totalUsd: number;
}

export interface GoalProgress {
  goalId: string;
  name: string;
  status: Database['public']['Enums']['goal_status'];
  targetAmountUsd: number | null;
  targetDate: string | null;
  contributedUsd: number;
  spentUsd: number;
  currentAmountUsd: number;
  lastMovementOn: string | null;
  progressRatio: number | null;
}

/**
 * Coerces a Postgres `numeric` to a JS number. PostgREST may serialise these as
 * strings to preserve precision, so nothing may assume a number arrived.
 */
function num(value: number | string | null): number {
  return value === null ? 0 : Number(value);
}

/**
 * Same coercion, preserving null so "no data" stays distinguishable from zero.
 */
function nullableNum(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Throws with the PostgREST message so a failed query never degrades into an
 * empty dashboard that silently reads as "you spent nothing".
 */
function unwrap<T>(result: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  if (result.error !== null) {
    throw new Error(`No se pudo cargar ${what}: ${result.error.message}`);
  }
  return result.data ?? [];
}

/**
 * Returns the most recent `months` monthly summaries in chronological order,
 * ready to feed a time series.
 */
export async function getMonthlySummaries(
  supabase: Client,
  months = 12,
): Promise<MonthlySummary[]> {
  const result = await supabase
    .from('v_monthly_summary')
    .select('*')
    .order('period_month', { ascending: false })
    .limit(months);

  return unwrap(result, 'el resumen mensual')
    .map((row) => ({
      periodMonth: row.period_month,
      incomeUsd: num(row.income_usd),
      expenseUsd: num(row.expense_usd),
      pendingExpenseUsd: num(row.pending_expense_usd),
      savedUsd: num(row.saved_usd),
      netUsd: num(row.net_usd),
      savingsRate: nullableNum(row.savings_rate),
      txCount: Number(row.tx_count),
    }))
    .reverse();
}

/**
 * Returns expense per category for a single month, largest first.
 */
export async function getCategorySpend(
  supabase: Client,
  periodMonth: string,
): Promise<CategorySpend[]> {
  const result = await supabase
    .from('v_category_spend')
    .select('*')
    .eq('period_month', periodMonth)
    .order('total_usd', { ascending: false });

  return unwrap(result, 'el gasto por categoría').map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    parentName: row.parent_name,
    totalUsd: num(row.total_usd),
    txCount: Number(row.tx_count),
  }));
}

/**
 * Returns every active account with the balance its owner last declared and the
 * balance it holds today, which is that declaration plus everything recorded
 * after it. `currentUsd` is null while an account has never been declared.
 */
export async function getDeclaredBalances(supabase: Client): Promise<DeclaredBalance[]> {
  const result = await supabase
    .from('v_declared_balances')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return unwrap(result, 'los saldos por cuenta').map((row) => ({
    accountId: row.account_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    isSavings: row.is_savings,
    isAsset: row.is_asset,
    declaredUsd: nullableNum(row.declared_usd),
    declaredLocal: nullableNum(row.declared_local),
    localCurrency: row.local_currency,
    fxRateLocalUsd: nullableNum(row.fx_rate_local_usd),
    declaredAt: row.declared_at,
    declaredOn: row.declared_on,
    movementSinceUsd: num(row.movement_since_usd),
    currentUsd: nullableNum(row.current_usd),
    computedUsd: num(row.computed_usd),
    unrecordedUsd: nullableNum(row.unrecorded_usd),
  }));
}

/**
 * Returns total money held: declared balances carried forward by the movements
 * recorded after them. Returns zeroes with every account pending when nothing
 * has been declared yet.
 */
export async function getNetWorth(supabase: Client): Promise<NetWorth> {
  const result = await supabase.from('v_net_worth').select('*').limit(1);
  const [row] = unwrap(result, 'el patrimonio');

  if (row === undefined) {
    return {
      assetsUsd: 0,
      debtUsd: 0,
      netUsd: 0,
      accountsPending: 0,
      accountsTotal: 0,
      lastDeclaredAt: null,
    };
  }

  return {
    assetsUsd: num(row.assets_usd),
    debtUsd: num(row.debt_usd),
    netUsd: num(row.net_usd),
    accountsPending: Number(row.accounts_pending),
    accountsTotal: Number(row.accounts_total),
    lastDeclaredAt: row.last_declared_at,
  };
}

/**
 * Returns budget against actual spend for a single month, most consumed first
 * so anything about to overrun surfaces at the top.
 *
 * Goes through the `budget_vs_actual` function rather than a view because the
 * effective ceiling depends on the month being asked about: a one-off override
 * when one exists, otherwise the standing template in force that month.
 */
export async function getBudgetVsActual(
  supabase: Client,
  periodMonth: string,
): Promise<BudgetVsActual[]> {
  const result = await supabase.rpc('budget_vs_actual', { p_month: periodMonth });

  if (result.error !== null) {
    throw new Error(`No se pudo cargar el presupuesto: ${result.error.message}`);
  }

  return (result.data ?? []).map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    parentName: row.parent_name,
    budgetUsd: num(row.budget_usd),
    templateUsd: nullableNum(row.template_usd),
    isOverride: row.is_override,
    spentUsd: num(row.spent_usd),
    remainingUsd: num(row.remaining_usd),
    consumedRatio: num(row.consumed_ratio),
  }));
}

/**
 * Returns expense per category for the last `months` months, oldest first.
 *
 * Deliberately returns the long form rather than pivoting here: which series
 * are worth drawing is a presentation decision, and the chart makes it.
 */
export async function getCategoryTrend(
  supabase: Client,
  months = 12,
): Promise<CategoryTrendPoint[]> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCMonth(since.getUTCMonth() - (months - 1));
  const from = since.toISOString().slice(0, 8) + '01';

  const result = await supabase
    .from('v_category_spend')
    .select('period_month, category_id, category_name, total_usd')
    .gte('period_month', from)
    .order('period_month', { ascending: true });

  return unwrap(result, 'la tendencia por categoría').map((row) => ({
    periodMonth: row.period_month,
    categoryId: row.category_id,
    categoryName: row.category_name,
    totalUsd: num(row.total_usd),
  }));
}

/**
 * Returns progress for every savings goal, active ones first.
 */
export async function getGoalProgress(supabase: Client): Promise<GoalProgress[]> {
  const result = await supabase
    .from('v_goal_progress')
    .select('*')
    .order('name', { ascending: true });

  return unwrap(result, 'las metas de ahorro')
    .map((row) => ({
      goalId: row.goal_id,
      name: row.name,
      status: row.status,
      targetAmountUsd: nullableNum(row.target_amount_usd),
      targetDate: row.target_date,
      contributedUsd: num(row.contributed_usd),
      spentUsd: num(row.spent_usd),
      currentAmountUsd: num(row.current_amount_usd),
      lastMovementOn: row.last_movement_on,
      progressRatio: nullableNum(row.progress_ratio),
    }))
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'));
}
