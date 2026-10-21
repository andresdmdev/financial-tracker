import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { memberMovementInputSchema } from '@/lib/schemas';

/**
 * Records a guest's income or expense on a goal shared with it.
 *
 * The row belongs to the owner: `user_id`, account and category all come from
 * the share, never from the body, so the movement lands in the owner's ledger
 * exactly as if the owner had entered it. The RLS insert policy checks the same
 * fields again, which is what stops a guest calling PostgREST directly. The
 * author is stamped by a trigger from the JWT.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (locals.role !== 'member') return fail('Solo para invitados', 403);
  if (params.id === undefined) return fail('Falta el identificador de la meta');

  const parsed = await parseBody(request, memberMovementInputSchema);
  if (!parsed.ok) return parsed.response;

  const share = await locals.supabase
    .from('goal_shares')
    .select('user_id, account_id, expense_category_id, income_category_id')
    .eq('goal_id', params.id)
    .eq('member_email', (locals.user.email ?? '').trim().toLowerCase())
    .maybeSingle();

  if (share.error !== null) return fromPostgrestError(share.error);
  if (share.data === null) return fail('Esta meta no está compartida contigo', 403);

  const input = parsed.data;

  const { data, error } = await locals.supabase
    .from('transactions')
    .insert({
      user_id: share.data.user_id,
      occurred_on: input.occurred_on,
      direction: input.direction,
      category_id:
        input.direction === 'expense'
          ? share.data.expense_category_id
          : share.data.income_category_id,
      account_id: share.data.account_id,
      amount_usd: input.amount_usd,
      amount_local: input.amount_local,
      local_currency: input.local_currency,
      fx_rate_local_usd:
        input.amount_local === null
          ? null
          : Number((input.amount_local / input.amount_usd).toFixed(6)),
      status: 'paid',
      goal_id: params.id,
      tags: input.tags,
      notes: input.notes,
      payment_method: input.payment_method,
      source: 'app',
    })
    .select('id')
    .single();

  if (error !== null) return fromPostgrestError(error);
  return json({ id: data.id }, 201);
};
