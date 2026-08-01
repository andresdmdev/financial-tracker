import { defineMiddleware } from 'astro:middleware';
import { ADMIN_EMAIL } from '@/lib/env';
import { createSupabaseServerContext } from '@/lib/supabase/server';

/**
 * Routes reachable without a session. Everything else redirects to /login.
 * `/auth/*` must stay open so the OAuth callback can create the session it
 * would otherwise be asked to already have.
 */
const PUBLIC_PREFIXES = ['/login', '/auth/', '/api/auth/'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix),
  );
}

/**
 * Authenticates every request and publishes the Supabase client on `locals`.
 *
 * Two independent gates protect the app: Supabase Auth has signups disabled,
 * and this middleware rejects any identity whose email is not ADMIN_EMAIL. The
 * session is validated with `getUser()` rather than `getSession()` because only
 * the former asks the auth server whether the JWT is still genuine.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { supabase, responseHeaders } = createSupabaseServerContext(
    context.request,
    context.cookies,
  );

  context.locals.supabase = supabase;
  context.locals.user = null;

  const applyHeaders = (response: Response): Response => {
    for (const [key, value] of Object.entries(responseHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user !== null) {
    if (user.email?.trim().toLowerCase() === ADMIN_EMAIL) {
      context.locals.user = user;
    } else {
      await supabase.auth.signOut();
      return applyHeaders(
        new Response('Forbidden', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      );
    }
  }

  const { pathname } = context.url;

  if (context.locals.user === null && !isPublicRoute(pathname)) {
    return applyHeaders(context.redirect('/login'));
  }

  if (context.locals.user !== null && pathname === '/login') {
    return applyHeaders(context.redirect('/'));
  }

  return applyHeaders(await next());
});
