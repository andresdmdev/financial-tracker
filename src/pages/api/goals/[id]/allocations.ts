import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalAllocationsInputSchema } from '@/lib/schemas';

/**
 * Replaces where a goal's saved money currently sits.
 *
 * The body carries the complete split, not a delta: removing an account is
 * expressed by leaving it out. Delete-then-insert rather than a diff because
 * the set is tiny and a wholesale replace cannot leave a stale row behind.
 *
 * The total is deliberately not forced to match the goal's accumulated amount.
 * A mismatch is information — money moved without being recorded — and the
 * subpage shows it instead of refusing the save.
 */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined) return fail('Falta el identificador de la meta');

  const parsed = await parseBody(request, goalAllocationsInputSchema);
  if (!parsed.ok) return parsed.response;

  const userId = locals.user.id;

  const goal = await locals.supabase
    .from('savings_goals')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();

  if (goal.error !== null) return fromPostgrestError(goal.error);
  if (goal.data === null) return fail('La meta no existe', 404);

  const cleared = await locals.supabase
    .from('goal_allocations')
    .delete()
    .eq('user_id', userId)
    .eq('goal_id', params.id);

  if (cleared.error !== null) return fromPostgrestError(cleared.error);

  if (parsed.data.allocations.length === 0) {
    return json({ goal_id: params.id, allocations: 0 });
  }

  const { error } = await locals.supabase.from('goal_allocations').insert(
    parsed.data.allocations.map((allocation) => ({
      user_id: userId,
      goal_id: params.id!,
      account_id: allocation.account_id,
      amount_usd: allocation.amount_usd,
    })),
  );

  if (error !== null) return fromPostgrestError(error);
  return json({ goal_id: params.id, allocations: parsed.data.allocations.length });
};
