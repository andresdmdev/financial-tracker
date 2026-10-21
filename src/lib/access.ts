import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { ADMIN_EMAIL } from '@/lib/env';

/**
 * Who may use the app and how far.
 *
 * The owner is ADMIN_EMAIL and sees everything. A member is a guest that the
 * owner shared one or more goals with; it may only open those goals and record
 * movements on them. Any other identity has no access at all.
 */
export type Role = 'owner' | 'member';

export interface Access {
  role: Role;
  sharedGoalIds: string[];
}

/**
 * Resolves the access level of an authenticated user, or null when the user
 * must be turned away.
 *
 * A guest's shares are read through its own session: the `goal_shares` select
 * policy only returns rows whose `member_email` matches the JWT, so this query
 * cannot see anybody else's grants.
 */
export async function resolveAccess(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<Access | null> {
  const email = user.email?.trim().toLowerCase();
  if (email === undefined || email === '') return null;
  if (email === ADMIN_EMAIL) return { role: 'owner', sharedGoalIds: [] };

  const { data, error } = await supabase
    .from('goal_shares')
    .select('goal_id')
    .eq('member_email', email)
    .order('created_at', { ascending: true });

  if (error !== null || data === null || data.length === 0) return null;
  return { role: 'member', sharedGoalIds: data.map((row) => row.goal_id) };
}

export type MemberRouteVerdict = 'allow' | 'redirect' | 'forbid';

/**
 * Decides whether a guest may reach a route.
 *
 * Only the detail page of a shared goal and the endpoint that records a
 * movement on it are open. Any other page redirects to the guest's first goal
 * so a stray link lands somewhere useful; any other API call is refused.
 */
export function memberRoute(
  pathname: string,
  method: string,
  sharedGoalIds: string[],
): MemberRouteVerdict {
  const page = pathname.match(/^\/goals\/([^/]+)\/?$/);
  if (page !== null && method === 'GET' && sharedGoalIds.includes(page[1]!)) return 'allow';

  const movements = pathname.match(/^\/api\/goals\/([^/]+)\/movements\/?$/);
  if (movements !== null && method === 'POST' && sharedGoalIds.includes(movements[1]!)) {
    return 'allow';
  }

  return pathname.startsWith('/api/') ? 'forbid' : 'redirect';
}
