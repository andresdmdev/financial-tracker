import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalInputSchema } from '@/lib/schemas';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined) return fail('Falta el identificador');

  const parsed = await parseBody(request, goalInputSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await locals.supabase
    .from('savings_goals')
    .update(parsed.data)
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La meta no existe', 404);
  return json({ id: data.id });
};

/**
 * Deletes a goal. Transactions that referenced it keep their history and simply
 * lose the link, because `goal_id` is `on delete set null`.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined) return fail('Falta el identificador');

  const { data, error } = await locals.supabase
    .from('savings_goals')
    .delete()
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La meta no existe', 404);
  return json({ id: data.id });
};
