import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { accountBalancesInputSchema } from '@/lib/schemas';
import type { Database } from '@/lib/database.types';

type BalanceInsert = Database['public']['Tables']['account_balances']['Insert'];

/**
 * Records a round of declared balances, one row per account.
 *
 * Insert, never upsert: the table is an append-only history, so declaring a
 * balance again adds an observation rather than rewriting the previous one.
 * That history is what makes the figure auditable later.
 *
 * When an account is held in another currency the USD value is derived here
 * from the local amount and the rate, so the two can never contradict each
 * other — the same rule transactions follow.
 *
 * `captured_on` decides which transactions get added on top of the figure, so it
 * is taken from the client's calendar rather than the server's. When absent the
 * column default fills in the UTC date.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);

  const parsed = await parseBody(request, accountBalancesInputSchema);
  if (!parsed.ok) return parsed.response;

  const userId = locals.user.id;
  const capturedOn = parsed.data.captured_on;

  const rows: BalanceInsert[] = parsed.data.entries.map((entry) => {
    const hasLocal =
      entry.balance_local !== null &&
      entry.local_currency !== null &&
      entry.fx_rate_local_usd !== null;

    return {
      user_id: userId,
      account_id: entry.account_id,
      balance_usd: hasLocal
        ? Number((entry.balance_local! / entry.fx_rate_local_usd!).toFixed(2))
        : entry.balance_usd!,
      balance_local: hasLocal ? entry.balance_local : null,
      local_currency: hasLocal ? entry.local_currency : null,
      fx_rate_local_usd: hasLocal ? entry.fx_rate_local_usd : null,
      notes: parsed.data.notes,
      ...(capturedOn === null ? {} : { captured_on: capturedOn }),
    };
  });

  const { error } = await locals.supabase.from('account_balances').insert(rows);
  if (error !== null) return fromPostgrestError(error);

  return json({ inserted: rows.length }, 201);
};
