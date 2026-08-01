/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_SITE_URL: string;
  readonly ADMIN_EMAIL: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /**
     * Request-scoped Supabase client bound to the session cookies. Always use
     * this one on the server: it carries the user's JWT, so RLS applies.
     */
    supabase: import('@supabase/supabase-js').SupabaseClient<
      import('./lib/database.types').Database
    >;
    /**
     * Authenticated admin user, or null on public routes. Validated against the
     * auth server by the middleware, not merely decoded from the cookie.
     */
    user: import('@supabase/supabase-js').User | null;
  }
}
