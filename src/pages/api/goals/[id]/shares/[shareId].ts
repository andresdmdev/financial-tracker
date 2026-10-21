import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json } from '@/lib/api';

/**
 * Revokes a guest's access to a goal.
 *
 * Only the grant goes. The guest's movements stay, since they are the owner's
 * money, and so does the `En manos de` account they were charged to, which may
 * still hold a balance or serve another shared goal.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (locals.role !== 'owner') return fail('Sin acceso', 403);
  if (params.id === undefined || params.shareId === undefined) {
    return fail('Falta el identificador');
  }

  const { data, error } = await locals.supabase
    .from('goal_shares')
    .delete()
    .eq('id', params.shareId)
    .eq('goal_id', params.id)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('El acceso no existe', 404);
  return json({ id: data.id });
};
