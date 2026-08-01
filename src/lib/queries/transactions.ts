import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, LocalCurrency, TxDirection, TxStatus } from '@/lib/database.types';

type Client = SupabaseClient<Database>;

export interface LookupOption {
  id: string;
  name: string;
}

export interface CategoryOption extends LookupOption {
  kind: Database['public']['Enums']['category_kind'];
  parentName: string | null;
}

export interface Lookups {
  accounts: LookupOption[];
  categories: CategoryOption[];
  goals: LookupOption[];
}

export interface TransactionFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  direction?: TxDirection;
  status?: TxStatus;
  tag?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TransactionListItem {
  id: string;
  occurredOn: string;
  direction: TxDirection;
  status: TxStatus;
  amountUsd: number;
  amountLocal: number | null;
  localCurrency: LocalCurrency | null;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  goalId: string | null;
  goalName: string | null;
  tags: string[];
  notes: string | null;
}

export interface TransactionPage {
  items: TransactionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

interface JoinedName {
  name: string;
}

interface RawTransaction {
  id: string;
  occurred_on: string;
  direction: TxDirection;
  status: TxStatus;
  amount_usd: number | string;
  amount_local: number | string | null;
  local_currency: LocalCurrency | null;
  category_id: string | null;
  account_id: string;
  to_account_id: string | null;
  goal_id: string | null;
  tags: string[];
  notes: string | null;
  category: JoinedName | null;
  account: JoinedName | null;
  to_account: JoinedName | null;
  goal: JoinedName | null;
}

/**
 * Loads the option lists every transaction form needs, in display order.
 */
export async function getLookups(supabase: Client): Promise<Lookups> {
  const [accounts, categories, goals] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('categories')
      .select('id, name, kind, sort_order, parent:parent_id (name)')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('savings_goals').select('id, name').eq('status', 'active').order('name'),
  ]);

  for (const result of [accounts, categories, goals]) {
    if (result.error !== null) {
      throw new Error(`No se pudieron cargar los catálogos: ${result.error.message}`);
    }
  }

  return {
    accounts: (accounts.data ?? []).map((row) => ({ id: row.id, name: row.name })),
    categories: (categories.data ?? []).map((row) => {
      const parent = row.parent as unknown as JoinedName | null;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        parentName: parent?.name ?? null,
      };
    }),
    goals: (goals.data ?? []).map((row) => ({ id: row.id, name: row.name })),
  };
}

/**
 * Lists transactions newest first, applying the filters the page exposes.
 *
 * Every filter is optional and additive; the count comes from the same query so
 * pagination stays consistent with what is being shown.
 */
export async function listTransactions(
  supabase: Client,
  filters: TransactionFilters = {},
): Promise<TransactionPage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('transactions')
    .select(
      `id, occurred_on, direction, status, amount_usd, amount_local, local_currency,
       category_id, account_id, to_account_id, goal_id, tags, notes,
       category:category_id (name),
       account:account_id (name),
       to_account:to_account_id (name),
       goal:goal_id (name)`,
      { count: 'exact' },
    )
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (filters.from !== undefined) query = query.gte('occurred_on', filters.from);
  if (filters.to !== undefined) query = query.lte('occurred_on', filters.to);
  if (filters.categoryId !== undefined) query = query.eq('category_id', filters.categoryId);
  if (filters.accountId !== undefined) {
    query = query.or(`account_id.eq.${filters.accountId},to_account_id.eq.${filters.accountId}`);
  }
  if (filters.direction !== undefined) query = query.eq('direction', filters.direction);
  if (filters.status !== undefined) query = query.eq('status', filters.status);
  if (filters.tag !== undefined) query = query.contains('tags', [filters.tag]);
  if (filters.search !== undefined && filters.search.trim() !== '') {
    query = query.ilike('notes', `%${filters.search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error !== null) {
    throw new Error(`No se pudieron cargar las transacciones: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as RawTransaction[];

  return {
    items: rows.map((row) => ({
      id: row.id,
      occurredOn: row.occurred_on,
      direction: row.direction,
      status: row.status,
      amountUsd: Number(row.amount_usd),
      amountLocal: row.amount_local === null ? null : Number(row.amount_local),
      localCurrency: row.local_currency,
      categoryId: row.category_id,
      categoryName: row.category?.name ?? null,
      accountId: row.account_id,
      accountName: row.account?.name ?? '—',
      toAccountId: row.to_account_id,
      toAccountName: row.to_account?.name ?? null,
      goalId: row.goal_id,
      goalName: row.goal?.name ?? null,
      tags: row.tags ?? [],
      notes: row.notes,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}
