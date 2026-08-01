import type { APIRoute } from 'astro';
import { ADMIN_EMAIL } from '@/lib/env';

/**
 * Completes the Google OAuth flow.
 *
 * Exchanges the authorization code for a session and re-checks the admin email
 * before letting the cookies stand. The middleware performs the same check on
 * every later request; doing it here means a rejected identity never gets a
 * usable session in the first place.
 */
export const GET: APIRoute = async ({ locals, url, redirect }) => {
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (providerError !== null) {
    return redirect(`/login?error=${encodeURIComponent(providerError)}`);
  }

  const code = url.searchParams.get('code');
  if (code === null) {
    return redirect('/login?error=Falta%20el%20c%C3%B3digo%20de%20autorizaci%C3%B3n');
  }

  const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const {
    data: { user },
  } = await locals.supabase.auth.getUser();

  if (user?.email?.trim().toLowerCase() !== ADMIN_EMAIL) {
    await locals.supabase.auth.signOut();
    return redirect('/login?error=Esta%20cuenta%20no%20tiene%20acceso');
  }

  return redirect('/');
};
