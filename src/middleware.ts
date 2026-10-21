import { defineMiddleware } from 'astro:middleware';
import { memberRoute, resolveAccess } from '@/lib/access';
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
 * and this middleware rejects any identity that is neither ADMIN_EMAIL nor a
 * guest with a shared goal. The session is validated with `getUser()` rather
 * than `getSession()` because only the former asks the auth server whether the
 * JWT is still genuine.
 *
 * A guest is confined to its shared goals here, but this only shapes the UI:
 * the guest could call PostgREST directly, so RLS is what actually limits it.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { supabase, responseHeaders } = createSupabaseServerContext(
    context.request,
    context.cookies,
  );

  context.locals.supabase = supabase;
  context.locals.user = null;
  context.locals.role = null;
  context.locals.sharedGoalIds = [];

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
    const access = await resolveAccess(supabase, user);
    if (access === null) {
      await supabase.auth.signOut();
      return applyHeaders(
        new Response('Forbidden', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      );
    }
    context.locals.user = user;
    context.locals.role = access.role;
    context.locals.sharedGoalIds = access.sharedGoalIds;
  }

  const { pathname } = context.url;

  if (context.locals.user === null && !isPublicRoute(pathname)) {
    return applyHeaders(context.redirect('/login'));
  }

  if (context.locals.user !== null && pathname === '/login') {
    return applyHeaders(context.redirect('/'));
  }

  if (context.locals.role === 'member' && !isPublicRoute(pathname)) {
    const verdict = memberRoute(pathname, context.request.method, context.locals.sharedGoalIds);
    if (verdict === 'redirect') {
      return applyHeaders(context.redirect(`/goals/${context.locals.sharedGoalIds[0]}`));
    }
    if (verdict === 'forbid') {
      return applyHeaders(
        new Response(JSON.stringify({ error: 'Sin acceso' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      );
    }
  }

  return applyHeaders(await next());
});
