import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, GoalStatus, LocalCurrency, TxDirection } from '@/lib/database.types';

type Client = SupabaseClient<Database>;

export interface GoalDetail {
  id: string;
  name: string;
  notes: string | null;
  status: GoalStatus;
  targetAmountUsd: number | null;
  targetDate: string | null;
  accountId: string | null;
}

export interface GoalMovement {
  id: string;
  occurredOn: string;
  direction: TxDirection;
  amountUsd: number;
  amountLocal: number | null;
  localCurrency: LocalCurrency | null;
  accountName: string;
  toAccountName: string | null;
  categoryName: string | null;
  tags: string[];
  notes: string | null;
  paymentMethod: string | null;
  createdByEmail: string | null;
  createdByName: string | null;
  source: string;
}

export interface GoalShare {
  id: string;
  memberEmail: string;
  memberName: string;
  accountName: string;
  expenseCategoryName: string;
  incomeCategoryName: string;
}

export interface GoalProgressPoint {
  occurredOn: string;
  balanceUsd: number;
}

export interface GoalAllocation {
  accountId: string;
  accountName: string;
  amountUsd: number;
}

interface JoinedName {
  name: string;
}

/**
 * Loads a single goal, or null when it does not exist or belongs to somebody
 * else — RLS makes those two cases indistinguishable, which is the point.
 */
export async function getGoal(supabase: Client, goalId: string): Promise<GoalDetail | null> {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('id, name, notes, status, target_amount_usd, target_date, account_id')
    .eq('id', goalId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`No se pudo cargar la meta: ${error.message}`);
  }
  if (data === null) return null;

  return {
    id: data.id,
    name: data.name,
    notes: data.notes,
    status: data.status,
    targetAmountUsd: data.target_amount_usd === null ? null : Number(data.target_amount_usd),
    targetDate: data.target_date,
    accountId: data.account_id,
  };
}

/**
 * Every movement charged to a goal, oldest first.
 *
 * Both directions matter: a transfer feeds the fund and an expense drains it,
 * which is what buying the thing the fund was for looks like.
 */
export async function getGoalMovements(
  supabase: Client,
  goalId: string,
): Promise<GoalMovement[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      `id, occurred_on, direction, amount_usd, amount_local, local_currency, tags, notes,
       payment_method, created_by_email, created_by_name, source,
       account:account_id (name),
       to_account:to_account_id (name),
       category:category_id (name)`,
    )
    .eq('goal_id', goalId)
    .eq('status', 'paid')
    .order('occurred_on', { ascending: true })
    .order('created_at', { ascending: true });

  if (error !== null) {
    throw new Error(`No se pudieron cargar los movimientos: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const account = row.account as unknown as JoinedName | null;
    const toAccount = row.to_account as unknown as JoinedName | null;
    const category = row.category as unknown as JoinedName | null;

    return {
      id: row.id,
      occurredOn: row.occurred_on,
      direction: row.direction,
      amountUsd: Number(row.amount_usd),
      amountLocal: row.amount_local === null ? null : Number(row.amount_local),
      localCurrency: row.local_currency,
      accountName: account?.name ?? '—',
      toAccountName: toAccount?.name ?? null,
      categoryName: category?.name ?? null,
      tags: row.tags,
      notes: row.notes,
      paymentMethod: row.payment_method,
      createdByEmail: row.created_by_email,
      createdByName: row.created_by_name,
      source: row.source,
    };
  });
}

/**
 * Who a movement is attributed to, as shown under its amount. Null when the
 * row predates authorship and did not come from the spreadsheet either.
 */
export function authorLabel(movement: GoalMovement): string | null {
  if (movement.createdByName !== null) return `Creado por ${movement.createdByName}`;
  if (movement.source === 'sheets-import') return 'Importado de la hoja';
  return null;
}

/**
 * Turns the movement list into a running balance, so the chart shows how the
 * fund actually filled up rather than the size of each individual contribution.
 * Transfers and income feed the fund and expenses drain it, matching
 * `v_goal_progress`.
 */
export function toProgressSeries(movements: GoalMovement[]): GoalProgressPoint[] {
  const points: GoalProgressPoint[] = [];
  let balance = 0;

  for (const movement of movements) {
    balance += movement.direction === 'expense' ? -movement.amountUsd : movement.amountUsd;
    const last = points.at(-1);

    if (last !== undefined && last.occurredOn === movement.occurredOn) {
      last.balanceUsd = balance;
      continue;
    }

    points.push({ occurredOn: movement.occurredOn, balanceUsd: balance });
  }

  return points;
}

/**
 * Where the money saved for a goal currently sits, largest holding first.
 */
export async function getGoalAllocations(
  supabase: Client,
  goalId: string,
): Promise<GoalAllocation[]> {
  const { data, error } = await supabase
    .from('goal_allocations')
    .select('account_id, amount_usd, account:account_id (name)')
    .eq('goal_id', goalId)
    .order('amount_usd', { ascending: false });

  if (error !== null) {
    throw new Error(`No se pudo cargar el reparto: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const account = row.account as unknown as JoinedName | null;
    return {
      accountId: row.account_id,
      accountName: account?.name ?? '—',
      amountUsd: Number(row.amount_usd),
    };
  });
}

/**
 * Guests a goal is shared with, oldest grant first. Owner-only: a guest's
 * session would only ever see its own row.
 */
export async function getGoalShares(supabase: Client, goalId: string): Promise<GoalShare[]> {
  const { data, error } = await supabase
    .from('goal_shares')
    .select(
      `id, member_email, member_name,
       account:account_id (name),
       expense_category:expense_category_id (name),
       income_category:income_category_id (name)`,
    )
    .eq('goal_id', goalId)
    .order('created_at', { ascending: true });

  if (error !== null) {
    throw new Error(`No se pudieron cargar los accesos: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const account = row.account as unknown as JoinedName | null;
    const expenseCategory = row.expense_category as unknown as JoinedName | null;
    const incomeCategory = row.income_category as unknown as JoinedName | null;

    return {
      id: row.id,
      memberEmail: row.member_email,
      memberName: row.member_name,
      accountName: account?.name ?? '—',
      expenseCategoryName: expenseCategory?.name ?? '—',
      incomeCategoryName: incomeCategory?.name ?? '—',
    };
  });
}
