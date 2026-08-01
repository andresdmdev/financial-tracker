import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { transactionInputSchema, type TransactionInput } from '@/lib/schemas';

/**
 * Builds the database row from validated input.
 *
 * The exchange rate is derived here rather than accepted from the client so the
 * three money columns can never disagree, and `user_id` is taken from the
 * session so a request cannot write into someone else's data.
 */
export function toRow(input: TransactionInput, userId: string) {
  return {
    user_id: userId,
    occurred_on: input.occurred_on,
    direction: input.direction,
    category_id: input.category_id,
    account_id: input.account_id,
    to_account_id: input.to_account_id,
    amount_usd: input.amount_usd,
    amount_local: input.amount_local,
    local_currency: input.local_currency,
    fx_rate_local_usd:
      input.amount_local === null
        ? null
        : Number((input.amount_local / input.amount_usd).toFixed(6)),
    status: input.status,
    goal_id: input.goal_id,
    tags: input.tags,
    notes: input.notes,
    source: 'app',
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);

  const parsed = await parseBody(request, transactionInputSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await locals.supabase
    .from('transactions')
    .insert(toRow(parsed.data, locals.user.id))
    .select('id')
    .single();

  if (error !== null) return fromPostgrestError(error);
  return json({ id: data.id }, 201);
};
