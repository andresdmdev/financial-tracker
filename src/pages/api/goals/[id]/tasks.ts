import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalTaskCreateSchema } from '@/lib/schemas';
import { GOAL_TASK_COLUMNS, toGoalTask } from '@/lib/queries/goal-tasks';

/**
 * Creates a task on a goal, for the owner or a guest it is shared with.
 *
 * The goal comes from the URL and the owning `user_id` from the goal itself —
 * both the owner and a guest can read it — never from the body. The RLS insert
 * policy checks the same pairing for guests, and the trigger stamps the author.
 *
 * `section_id` places the task in one of the goal's sections. A composite
 * foreign key rejects a section of another goal and the trigger rejects a
 * deleted one, so the route does not re-check either.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined) return fail('Falta el identificador de la meta');

  const parsed = await parseBody(request, goalTaskCreateSchema);
  if (!parsed.ok) return parsed.response;

  const goal = await locals.supabase
    .from('savings_goals')
    .select('user_id')
    .eq('id', params.id)
    .maybeSingle();

  if (goal.error !== null) return fromPostgrestError(goal.error);
  if (goal.data === null) return fail('La meta no existe', 404);

  const { data, error } = await locals.supabase
    .from('goal_tasks')
    .insert({ ...parsed.data, user_id: goal.data.user_id, goal_id: params.id })
    .select(GOAL_TASK_COLUMNS)
    .single();

  if (error !== null) return fromPostgrestError(error);
  return json(toGoalTask(data), 201);
};
