import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import type { Database } from '@/lib/database.types';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

export interface SupabaseServerContext {
  /** Request-scoped client carrying the session cookies, so RLS applies. */
  supabase: SupabaseClient<Database>;
  /**
   * Cache headers Supabase requires whenever it writes auth cookies. They must
   * be copied onto the outgoing response so no CDN caches one session's tokens.
   */
  responseHeaders: Record<string, string>;
}

/**
 * Builds a Supabase client bound to a single Astro request.
 *
 * Cookies are read from the raw `Cookie` header and written through
 * `Astro.cookies`, which Astro flushes onto whatever response the request
 * produces — including redirects issued from middleware.
 *
 * A client must never be reused across requests: it holds one user's tokens.
 */
export function createSupabaseServerContext(
  request: Request,
  cookies: AstroCookies,
): SupabaseServerContext {
  const responseHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: {
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: 'lax',
      path: '/',
    },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(
          ({ name, value }) => ({ name, value: value ?? '' }),
        );
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, options);
        }
        Object.assign(responseHeaders, headers);
      },
    },
  });

  return { supabase, responseHeaders };
}
