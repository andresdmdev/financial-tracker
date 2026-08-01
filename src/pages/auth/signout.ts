import type { APIRoute } from 'astro';

/**
 * Ends the session and clears the auth cookies.
 *
 * POST only: a GET would let any third-party image or link sign the user out.
 */
export const POST: APIRoute = async ({ locals, redirect }) => {
  await locals.supabase.auth.signOut();
  return redirect('/login', 303);
};
