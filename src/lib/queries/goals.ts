import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, GoalStatus, TxDirection } from '@/lib/database.types';

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
  accountName: string;
  toAccountName: string | null;
  notes: string | null;
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
      `id, occurred_on, direction, amount_usd, notes,
       account:account_id (name),
       to_account:to_account_id (name)`,
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

    return {
      id: row.id,
      occurredOn: row.occurred_on,
      direction: row.direction,
      amountUsd: Number(row.amount_usd),
      accountName: account?.name ?? '—',
      toAccountName: toAccount?.name ?? null,
      notes: row.notes,
    };
  });
}

/**
 * Turns the movement list into a running balance, so the chart shows how the
 * fund actually filled up rather than the size of each individual contribution.
 */
export function toProgressSeries(movements: GoalMovement[]): GoalProgressPoint[] {
  const points: GoalProgressPoint[] = [];
  let balance = 0;

  for (const movement of movements) {
    balance += movement.direction === 'transfer' ? movement.amountUsd : -movement.amountUsd;
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
