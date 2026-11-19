import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalSectionInputSchema } from '@/lib/schemas';

/**
 * Creates a work section on a goal. Owner only: guests read sections and work
 * their tasks but never write the document. RLS gives guests no insert policy
 * on `goal_sections`, so the role check here only produces a clearer error.
 * New sections go to the end of the menu.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (locals.role !== 'owner') return fail('Solo el dueño puede crear secciones', 403);
  if (params.id === undefined) return fail('Falta el identificador de la meta');

  const parsed = await parseBody(request, goalSectionInputSchema);
  if (!parsed.ok) return parsed.response;

  const last = await locals.supabase
    .from('goal_sections')
    .select('sort_order')
    .eq('goal_id', params.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last.error !== null) return fromPostgrestError(last.error);

  const { data, error } = await locals.supabase
    .from('goal_sections')
    .insert({
      ...parsed.data,
      user_id: locals.user.id,
      goal_id: params.id,
      sort_order: (last.data?.sort_order ?? -1) + 1,
    })
    .select('id')
    .single();

  if (error !== null) return fromPostgrestError(error);
  return json({ id: data.id }, 201);
};
