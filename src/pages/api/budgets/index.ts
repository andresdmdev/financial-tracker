import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { budgetInputSchema } from '@/lib/schemas';

/**
 * Sets the budget for a category, either for one month or from that month on.
 *
 * `forward` writes a standing template and clears any override for the same
 * month, so the amount the user just typed is the one that governs. `month`
 * writes only the override, leaving the template untouched — that is the whole
 * point of the distinction.
 *
 * Upsert rather than insert: setting a budget twice is a correction, not a
 * conflict the user should have to resolve by hand.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);

  const parsed = await parseBody(request, budgetInputSchema);
  if (!parsed.ok) return parsed.response;

  const { category_id, period_month, amount_usd, scope } = parsed.data;
  const userId = locals.user.id;

  if (scope === 'forward') {
    const { data, error } = await locals.supabase
      .from('budget_templates')
      .upsert(
        { user_id: userId, category_id, effective_from: period_month, amount_usd },
        { onConflict: 'user_id,category_id,effective_from' },
      )
      .select('id')
      .single();

    if (error !== null) return fromPostgrestError(error);

    const cleared = await locals.supabase
      .from('budgets')
      .delete()
      .eq('user_id', userId)
      .eq('category_id', category_id)
      .eq('period_month', period_month);

    if (cleared.error !== null) return fromPostgrestError(cleared.error);
    return json({ id: data.id, scope }, 201);
  }

  const { data, error } = await locals.supabase
    .from('budgets')
    .upsert(
      { user_id: userId, category_id, period_month, amount_usd },
      { onConflict: 'user_id,category_id,period_month' },
    )
    .select('id')
    .single();

  if (error !== null) return fromPostgrestError(error);
  return json({ id: data.id, scope }, 201);
};

/**
 * Removes a budget, addressed by category and month rather than by row id: the
 * amount shown for a month may come from a standing template, which has no row
 * of its own in that month.
 *
 * `scope=month` drops only the override, so the template takes over again.
 * `scope=all` stops budgeting the category altogether — every override and
 * every template for it. There is deliberately no "from this month on": that
 * would need a row meaning "no budget", and a single user is better served by
 * two outcomes they can predict than by three they have to reason about.
 */
export const DELETE: APIRoute = async ({ url, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);

  const categoryId = url.searchParams.get('category_id');
  const periodMonth = url.searchParams.get('period_month');
  const scope = url.searchParams.get('scope') ?? 'month';

  if (categoryId === null) return fail('Falta la categoría');
  if (scope !== 'month' && scope !== 'all') return fail('Alcance inválido');
  if (scope === 'month' && periodMonth === null) return fail('Falta el periodo');

  const userId = locals.user.id;

  const overrides = locals.supabase
    .from('budgets')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId);

  const cleared =
    scope === 'month'
      ? await overrides.eq('period_month', `${periodMonth!.slice(0, 7)}-01`)
      : await overrides;

  if (cleared.error !== null) return fromPostgrestError(cleared.error);

  if (scope === 'all') {
    const templates = await locals.supabase
      .from('budget_templates')
      .delete()
      .eq('user_id', userId)
      .eq('category_id', categoryId);

    if (templates.error !== null) return fromPostgrestError(templates.error);
  }

  return json({ category_id: categoryId, scope });
};
