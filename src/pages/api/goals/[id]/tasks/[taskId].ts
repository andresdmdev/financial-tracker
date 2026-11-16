import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalTaskInputSchema } from '@/lib/schemas';
import { GOAL_TASK_COLUMNS, toGoalTask } from '@/lib/queries/goal-tasks';

/**
 * Edits a live task. Scoped by goal as well as id so a task cannot be reached
 * through a goal it does not belong to; the trigger freezes ownership and
 * author whatever the body says.
 */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined || params.taskId === undefined) return fail('Falta el identificador');

  const parsed = await parseBody(request, goalTaskInputSchema);
  if (!parsed.ok) return parsed.response;

  const { data, error } = await locals.supabase
    .from('goal_tasks')
    .update(parsed.data)
    .eq('id', params.taskId)
    .eq('goal_id', params.id)
    .is('deleted_at', null)
    .select(GOAL_TASK_COLUMNS)
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La tarea no existe', 404);
  return json(toGoalTask(data));
};

/**
 * Removes a task logically. Guests have full use of a goal's tasks, so nothing
 * is ever really deleted: `deleted_at` hides the row and the trigger records
 * who did it. The timestamp sent here is replaced by the database's own.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (params.id === undefined || params.taskId === undefined) return fail('Falta el identificador');

  const { data, error } = await locals.supabase
    .from('goal_tasks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', params.taskId)
    .eq('goal_id', params.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error !== null) return fromPostgrestError(error);
  if (data === null) return fail('La tarea no existe', 404);
  return json({ id: data.id });
};
