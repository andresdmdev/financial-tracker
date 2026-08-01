import type { APIRoute } from 'astro';
import { SITE_URL } from '@/lib/env';

/**
 * Starts the Google OAuth flow.
 *
 * `skipBrowserRedirect` keeps Supabase from redirecting on its own so the PKCE
 * code verifier is written as a server cookie first; only then is the browser
 * sent to Google. Without it the verifier would never reach the callback.
 */
export const POST: APIRoute = async ({ locals, redirect }) => {
  const { data, error } = await locals.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${SITE_URL}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error !== null || !data.url) {
    const message = error?.message ?? 'No se pudo iniciar el flujo de Google';
    return redirect(`/login?error=${encodeURIComponent(message)}`, 303);
  }

  return new Response(null, { status: 303, headers: { Location: data.url } });
};
