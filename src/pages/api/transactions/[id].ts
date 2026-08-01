import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { transactionInputSchema } from '@/lib/schemas';
import { toRow } from './index';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined) return fail('Falta el identificador');

  const parsed = await parseBody(request, transactionInputSchema);
  if (!parsed.ok) return parsed.response;

  const { user_id: _ignored, ...row } = toRow(parsed.data, locals.user.id);

  const { data, error } = await locals.supabase
    .from('transactions')
    .update(row)
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La transacción no existe', 404);
  return json({ id: data.id });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined) return fail('Falta el identificador');

  const { data, error } = await locals.supabase
    .from('transactions')
    .delete()
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La transacción no existe', 404);
  return json({ id: data.id });
};
