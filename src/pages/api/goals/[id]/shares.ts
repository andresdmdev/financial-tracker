import type { APIRoute } from 'astro';
import { fail, fromPostgrestError, json, parseBody } from '@/lib/api';
import { goalShareInputSchema } from '@/lib/schemas';

/**
 * Shares a goal with a guest.
 *
 * Every movement the guest records is charged to an account named
 * `En manos de <nombre>`, created here on first share and reused for every
 * later goal shared with the same name. It stands for the owner's money held by
 * the guest, so a purchase paid from the guest's bank never moves the balance
 * of one of the owner's real accounts.
 *
 * The guest's auth user is not created here: signups are disabled and the
 * service-role key never reaches application code, so the owner adds the user
 * in the Supabase dashboard.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (locals.user === null) return fail('No autenticado', 401);
  if (locals.role !== 'owner') return fail('Sin acceso', 403);
  if (params.id === undefined) return fail('Falta el identificador de la meta');

  const parsed = await parseBody(request, goalShareInputSchema);
  if (!parsed.ok) return parsed.response;

  const input = parsed.data;
  const userId = locals.user.id;

  if (input.member_email === locals.user.email?.trim().toLowerCase()) {
    return fail('No puedes compartir la meta contigo mismo', 422, {
      member_email: 'Es tu propio email',
    });
  }

  const goal = await locals.supabase
    .from('savings_goals')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();

  if (goal.error !== null) return fromPostgrestError(goal.error);
  if (goal.data === null) return fail('La meta no existe', 404);

  const accountName = `En manos de ${input.member_name}`;

  const accounts = await locals.supabase.from('accounts').select('id, name');
  if (accounts.error !== null) return fromPostgrestError(accounts.error);

  let accountId =
    accounts.data.find((account) => account.name.toLowerCase() === accountName.toLowerCase())
      ?.id ?? null;

  if (accountId === null) {
    const created = await locals.supabase
      .from('accounts')
      .insert({
        user_id: userId,
        name: accountName,
        type: 'cash',
        currency: 'USD',
        sort_order: 90,
      })
      .select('id')
      .single();

    if (created.error !== null) return fromPostgrestError(created.error);
    accountId = created.data.id;
  }

  const { data, error } = await locals.supabase
    .from('goal_shares')
    .insert({
      user_id: userId,
      goal_id: params.id,
      member_email: input.member_email,
      member_name: input.member_name,
      account_id: accountId,
      expense_category_id: input.expense_category_id,
      income_category_id: input.income_category_id,
    })
    .select('id')
    .single();

  if (error !== null) {
    if (error.code === '23505') {
      return fail('Esta meta ya está compartida con ese email', 409, {
        member_email: 'Ya tiene acceso',
      });
    }
    return fromPostgrestError(error);
  }

  return json({ id: data.id }, 201);
};
