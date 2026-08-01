/**
 * Reads a required environment variable and fails fast when it is missing.
 * A missing Supabase credential must break the build or the first request,
 * never degrade into an unauthenticated client at runtime.
 */
function required(name: keyof ImportMetaEnv, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const SUPABASE_URL: string = required(
  'PUBLIC_SUPABASE_URL',
  import.meta.env.PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY: string = required(
  'PUBLIC_SUPABASE_ANON_KEY',
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
);

export const ADMIN_EMAIL: string = required('ADMIN_EMAIL', import.meta.env.ADMIN_EMAIL)
  .trim()
  .toLowerCase();

export const SITE_URL: string = (
  import.meta.env.PUBLIC_SITE_URL ?? 'http://localhost:4321'
).replace(/\/$/, '');
