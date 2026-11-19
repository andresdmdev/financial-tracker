import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalSectionInputSchema } from '@/lib/schemas';

/**
 * Edits a live section's title and markdown. Owner only.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (locals.role !== 'owner') return fail('Solo el dueño puede editar secciones', 403);
  if (params.id === undefined || params.sectionId === undefined) {
    return fail('Falta el identificador');
  }

  const parsed = await parseBody(request, goalSectionInputSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await locals.supabase
    .from('goal_sections')
    .update(parsed.data)
    .eq('id', params.sectionId)
    .eq('goal_id', params.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La sección no existe', 404);
  return json({ id: data.id });
};

/**
 * Removes a section logically. Owner only. Its tasks stay in the table but no
 * page shows them any more, and the trigger refuses new tasks in it.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (locals.role !== 'owner') return fail('Solo el dueño puede eliminar secciones', 403);
  if (params.id === undefined || params.sectionId === undefined) {
    return fail('Falta el identificador');
  }

  const { data, error } = await locals.supabase
    .from('goal_sections')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', params.sectionId)
    .eq('goal_id', params.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La sección no existe', 404);
  return json({ id: data.id });
};
