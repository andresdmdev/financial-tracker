import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, GoalTaskPriority, GoalTaskStatus } from '@/lib/database.types';

/**
 * Reads of a goal's tasks, plus the row mapping and ordering shared with the
 * island so a task saved in the browser lands exactly where a reload would put
 * it. Soft-deleted tasks are filtered here, never shown.
 */

type Client = SupabaseClient<Database>;

type GoalTaskRow = Database['public']['Tables']['goal_tasks']['Row'];

export interface GoalTask {
  id: string;
  title: string;
  description: string | null;
  tag: string | null;
  priority: GoalTaskPriority;
  status: GoalTaskStatus;
  completedOn: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Columns the app reads, also used as the `select` after an insert or update. */
export const GOAL_TASK_COLUMNS =
  'id, title, description, tag, priority, status, completed_on, created_by_name, created_at';

/**
 * Maps a row to the camelCase shape the UI uses.
 */
export function toGoalTask(
  row: Pick<
    GoalTaskRow,
    | 'id'
    | 'title'
    | 'description'
    | 'tag'
    | 'priority'
    | 'status'
    | 'completed_on'
    | 'created_by_name'
    | 'created_at'
  >,
): GoalTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tag: row.tag,
    priority: row.priority,
    status: row.status,
    completedOn: row.completed_on,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

/**
 * Open work first, by priority and then age; completed tasks sink to the
 * bottom, most recently finished first. Returns a new array.
 */
export function sortGoalTasks(tasks: GoalTask[]): GoalTask[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'completed';
    const bDone = b.status === 'completed';
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone && bDone) return (b.completedOn ?? '').localeCompare(a.completedOn ?? '');
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Every live task of a goal in display order: the general ones when
 * `sectionId` is null, otherwise only that section's. The two lists never mix.
 */
export async function getGoalTasks(
  supabase: Client,
  goalId: string,
  sectionId: string | null = null,
): Promise<GoalTask[]> {
  const base = supabase
    .from('goal_tasks')
    .select(GOAL_TASK_COLUMNS)
    .eq('goal_id', goalId)
    .is('deleted_at', null);

  const { data, error } = await (sectionId === null
    ? base.is('section_id', null)
    : base.eq('section_id', sectionId))
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });

  if (error !== null) {
    throw new Error(`No se pudieron cargar las tareas: ${error.message}`);
  }

  return sortGoalTasks((data ?? []).map(toGoalTask));
}

/**
 * Number of general tasks still to do on a goal, shown on the tab that leads
 * to them. Section tasks are counted in the sections menu instead.
 */
export async function getOpenGoalTaskCount(supabase: Client, goalId: string): Promise<number> {
  const { count, error } = await supabase
    .from('goal_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('goal_id', goalId)
    .is('deleted_at', null)
    .is('section_id', null)
    .neq('status', 'completed');

  if (error !== null) {
    throw new Error(`No se pudieron contar las tareas: ${error.message}`);
  }

  return count ?? 0;
}
