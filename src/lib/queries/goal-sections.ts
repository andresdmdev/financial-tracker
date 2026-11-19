import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Reads of a goal's work sections. Soft-deleted sections are filtered here and
 * never shown; their tasks survive in the table but have no page to live on.
 */

type Client = SupabaseClient<Database>;

export interface GoalSectionSummary {
  id: string;
  title: string;
  openTaskCount: number;
}

export interface GoalSection {
  id: string;
  title: string;
  contentMd: string;
  updatedAt: string;
}

/**
 * Every live section of a goal in menu order, each with how many of its own
 * tasks are still open.
 *
 * The counts come from a second query rather than an embedded PostgREST count:
 * the hand-written schema types declare no relationships, so an embed would
 * arrive untyped, and two small reads are clearer than a cast.
 */
export async function getGoalSections(
  supabase: Client,
  goalId: string,
): Promise<GoalSectionSummary[]> {
  const [sections, tasks] = await Promise.all([
    supabase
      .from('goal_sections')
      .select('id, title')
      .eq('goal_id', goalId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('goal_tasks')
      .select('section_id')
      .eq('goal_id', goalId)
      .is('deleted_at', null)
      .not('section_id', 'is', null)
      .neq('status', 'completed'),
  ]);

  if (sections.error !== null) {
    throw new Error(`No se pudieron cargar las secciones: ${sections.error.message}`);
  }
  if (tasks.error !== null) {
    throw new Error(`No se pudieron contar las tareas: ${tasks.error.message}`);
  }

  const open = new Map<string, number>();
  for (const task of tasks.data ?? []) {
    if (task.section_id !== null) open.set(task.section_id, (open.get(task.section_id) ?? 0) + 1);
  }

  return (sections.data ?? []).map((section) => ({
    id: section.id,
    title: section.title,
    openTaskCount: open.get(section.id) ?? 0,
  }));
}

/**
 * One live section of a goal, or null when it does not exist, was deleted, or
 * belongs to another goal — the page treats all three alike.
 */
export async function getGoalSection(
  supabase: Client,
  goalId: string,
  sectionId: string,
): Promise<GoalSection | null> {
  const { data, error } = await supabase
    .from('goal_sections')
    .select('id, title, content_md, updated_at')
    .eq('id', sectionId)
    .eq('goal_id', goalId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`No se pudo cargar la sección: ${error.message}`);
  }
  if (data === null) return null;

  return {
    id: data.id,
    title: data.title,
    contentMd: data.content_md,
    updatedAt: data.updated_at,
  };
}
