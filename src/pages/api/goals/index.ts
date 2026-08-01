import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalInputSchema } from '@/lib/schemas';

export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);

  const parsed = await parseBody(request, goalInputSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await locals.supabase
    .from('savings_goals')
    .insert({ ...parsed.data, user_id: locals.user.id })
    .select('id')
    .single();

  if (error !== null) return fromPostgrestError(error);
  return json({ id: data.id }, 201);
};
