# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user personal finance tracker. It replaces a Google Sheets workbook that was the previous source
of truth. Supabase (Postgres + Auth) is now the only source of truth; the spreadsheet was imported once and
is no longer synced. Only one Google account — `ADMIN_EMAIL` — may sign in.

`schema-example.json` documents the **old** spreadsheet shape. It is kept as a reference for the import
script and must not be treated as the current data model.

## Commands

```bash
pnpm dev                 # astro dev on http://localhost:4321
pnpm build               # astro check && astro build (type errors fail the build)
pnpm check               # type-check only
pnpm preview             # preview the production build

pnpm db:push             # apply supabase/migrations to the linked project
pnpm db:reset            # recreate the local database and re-run migrations + seed
pnpm db:types            # regenerate src/lib/database.types.ts from the schema

pnpm import:sheet -- --dry-run   # parse data/Invoices.csv and report without writing
pnpm import:sheet                # perform the idempotent import
```

The import script runs on Node's native TypeScript stripping — no bundler. That forbids non-erasable
syntax (`enum`, parameter properties) and requires explicit `.ts` extensions on relative imports.
`--verbose` lists every inferred `Gastos Hormiga` row; `--file` points at a different CSV.

Supabase CLI is not installed globally; prefix with `npx supabase` if `supabase` is not on PATH.

`supabase link` needs a Personal Access Token, which this project does not use. Apply migrations by
passing the connection string instead, which only needs `SUPABASE_DB_PASSWORD` from `.env`:

```bash
npx supabase db push --db-url "postgresql://postgres:<urlencoded-password>@db.<ref>.supabase.co:5432/postgres"
```

The direct host resolves to IPv6 only; the IPv4 fallback is the session-mode pooler on port 5432.
`supabase gen types` and `db reset` both require Docker Desktop to be running, so
`src/lib/database.types.ts` stays hand-written. Verify it against the live schema by diffing
`information_schema.columns` rather than assuming it drifted.

**Running `pnpm check` or `pnpm build` while `pnpm dev` is up corrupts the running dev server.** They share
`node_modules/.vite`, and the re-optimisation invalidates the module graph underneath the live server.
The symptom is not an error page: pages still return 200 because SSR is unaffected, but every island
fails with `[astro-island] Error hydrating … Failed to fetch dynamically imported module`, so the whole
UI renders and nothing responds to a click. Restart the dev server after either command:

```bash
npx astro dev stop && rm -rf node_modules/.vite && pnpm dev
npx astro dev logs        # grep for "Error hydrating" to confirm the islands are alive
```

On Windows, `pnpm build` type-checks and builds fine but the Vercel adapter's final bundling step fails
with `EPERM: symlink` unless Developer Mode is enabled (Settings → Privacy & security → For developers).
It is a local-only limitation — Vercel builds on Linux. Use `pnpm check` + `pnpm dev` locally if Developer
Mode is off.

## Architecture

Astro 7 in `output: 'server'` mode on the Vercel adapter. SSR is mandatory — auth is cookie-based, so
nothing can be prerendered except the login page.

- **`src/middleware.ts`** runs on every request. It builds the request-scoped Supabase client with
  `createServerClient` from `@supabase/ssr` (cookie `getAll`/`setAll` over `Astro.cookies`), calls
  `supabase.auth.getUser()`, enforces the admin-email guard, and publishes `locals.supabase` /
  `locals.user`. Public routes are only `/login` and `/auth/*`.
- **Pages** (`.astro`) fetch through `Astro.locals.supabase` during SSR and pass plain serializable data
  into islands. Never create a Supabase client inside a page.
- **Islands** (`.tsx` under `src/components/`) are React and receive data as props. Use `client:load` only
  for above-the-fold interactivity, `client:visible` otherwise. A component that renders no interaction
  belongs in `.astro`, not React.
- **Writes** go through API routes under `src/pages/api/`, validated with the Zod schemas in
  `src/lib/schemas.ts`, using `locals.supabase` (anon key + RLS). The service-role key never appears in
  application code — only in `scripts/import-sheet.ts`.

## Data model invariants

These are enforced by check constraints; code must not work around them.

- **`amount_usd` is canonical and always positive.** Direction comes from the `direction` column
  (`income | expense | transfer`), never from the sign. `amount_ves` + `fx_rate_ves_usd` preserve the
  original bolivar amount and must be written together or not at all.
- **Transfers are excluded from every income/expense aggregation.** Moving money into a savings goal is a
  `transfer`, not an expense. Any new query that sums spending must filter `direction = 'expense'`.
- **A `transfer` has `to_account_id` and no `category_id`; anything else has `category_id`.**
- **Categories are rows, not an enum** (`categories` table) so new ones need no migration. Behavioural
  labels such as `gastos-hormiga` are values in the `tags text[]` column, not categories — a coffee is
  `Comida` *and* an impulse purchase at the same time.
- **Savings goals** (`savings_goals`) model the old `UPMacbook / Carro / Moto / Apartamento` categories.
  Contributing = `transfer` into the savings account carrying `goal_id`. Buying the thing = `expense` from
  the savings account carrying `goal_id` plus its real category.
- **`source_row_hash`** is unique per user and makes the spreadsheet import idempotent. Do not populate it
  from the app.

- **A balance derived from transactions is not a balance.** The spreadsheet was a single-entry ledger:
  it recorded which account money left, never the transfers between own accounts. `v_account_balances`
  therefore lies per account. `account_balances` holds what the user declares, and net worth comes from
  declared balances only — an account never declared reports `current_usd = null` and is counted in
  `accounts_pending`, never backfilled with the derived figure.
- **A declared balance rolls forward; it does not stand still.** `current_usd = declared_usd +
  movement_since_usd`, where the second term sums `v_account_ledger` over the movements that came
  *after* the snapshot. "After" is `occurred_on > captured_on`, plus same-day rows whose `created_at`
  is later than `captured_at` — a balance declared at 10am already contains the morning's coffee but
  not the afternoon's. Comparing dates alone is wrong in both directions: `>` freezes the figure until
  midnight on the day it is declared, `>=` double-counts everything spent before the declaration.
  `captured_on` is sent by the browser precisely because the server's UTC date is a different day in
  the evening. `computed_usd` and `unrecorded_usd` survive in the view for auditing the imported
  history and are deliberately not shown anywhere in the UI.
- **`accounts.currency` is not decoration.** Debit holds bolivares, so its snapshot carries
  `balance_local` + `fx_rate_local_usd` and the USD value is derived server-side. Same all-or-nothing
  rule as transactions, enforced by `num_nulls`.
- **A budget is a template plus exceptions.** `budget_templates` carries an amount from `effective_from`
  onwards; `budgets` is a single-month override. The effective ceiling is override ?? latest template
  in force, and only `budget_vs_actual(date)` knows how to resolve it. Never read `budgets` directly to
  answer "what is the budget for month X".
- **`goal_allocations` is manual and stays manual.** It records where a goal's money sits today;
  transactions record where it came from. Deriving one from the other produces a confident wrong answer.

Dashboard figures come from the `v_*` views in Postgres, not from client-side aggregation. Add a view
rather than pulling rows into the browser to sum them. Every view is declared `security_invoker = true`;
a view without it runs as its owner and quietly bypasses RLS. Where the answer depends on a parameter,
use a `stable` SQL function instead — it also runs as invoker, so RLS still applies.

`src/lib/database.types.ts` is hand-written until `pnpm db:types` replaces it. Two constraints hold either
way: the row shapes must be `type` aliases, not `interface` (interfaces get no implicit index signature, so
supabase-js resolves the whole schema to `never`), and `Insert` must mark nullable and defaulted columns
optional or valid inserts fail to type-check.

The app is **light only**. `AppLayout` carries no `.dark` class and `global.css` defines no dark tokens;
the `@custom-variant dark` declaration stays solely so the `dark:` utilities baked into the vendored
shadcn primitives keep compiling. Re-adding dark mode means re-validating every chart palette against
the second surface, not flipping a switch.

Chart colours live in `--chart-1..6` as fixed hex, validated **as a set** against the light card
surface: `#0d9488 #3b82f6 #d97706 #e11d48 #8b5cf6 #0891b2`. They pass the lightness band, chroma floor,
deuteranopia separation, normal-vision separation and 3:1 contrast. Assign them in order and never
cycle — a ninth series folds into "Otros" instead. Do not substitute one without re-running the
validator: they were chosen for colour-vision separation, not for looks.

Forms use `SelectField` from `src/components/forms/Field.tsx`, never a native `<select>`. The native
element renders its options through the OS, which ignores the page palette entirely — that is what made
the original dropdowns unreadable. Destructive confirmations use `AlertDialog`, never `window.confirm`,
for the same reason.

The typeface is Outfit, self-hosted through `@fontsource-variable/outfit` and imported in
`AppLayout.astro`; `--font-sans` points at `'Outfit Variable'`. Do not swap it for a Google Fonts link:
this app renders real personal finances and has no business announcing every page view to a third party.

Amounts render as `$1.234,56`, never `US$` or `USD`. `src/lib/format.ts` prepends the symbol by hand
because `Intl` with `style: 'currency'` writes `US$` in `es-VE` and `narrowSymbol` puts the minus sign
inside the symbol. Every amount in the app goes through `formatUsd`/`formatUsdCompact`, so that file is
the only place to change it.

Every amount also carries `.tabular` and steps up one size below `sm`, written mobile-first as
`text-3xl sm:text-2xl` on headline figures, `text-lg` on the mobile transaction cards, and
`text-base sm:text-sm` on row and total figures. A phone is read at arm's length and a balance is the
one thing on screen worth reading at a glance; desktop keeps the sizes it already had. Match the
neighbouring tier rather than inventing a size — the hierarchy between headline, row and caption is
what makes a dense screen scannable. An amount embedded mid-sentence is the exception and takes the
sentence's size, since a larger run of text inside a paragraph breaks the line rhythm. Text inside
charts is SVG with fixed pixel sizes and does not follow the breakpoint.

The layout is responsive without exception. Above `md` the sections are pills in the header; below it
they are a fixed bottom tab bar, and `<main>` reserves `pb-[calc(5.5rem+env(safe-area-inset-bottom))]`
so nothing hides under it. The transaction list is a `<table>` from `sm` up and a card list below —
a six-column table that scrolls sideways on a phone fits the viewport without being readable.

## Security rules

- RLS is enabled on every table with `auth.uid() = user_id`. New tables need a `user_id` column and the
  same four policies before any code reads them.
- Signups are disabled in Supabase Auth and the middleware rejects any email other than `ADMIN_EMAIL`.
  Both layers stay — do not remove one because the other exists.
- Only `PUBLIC_*` variables may reach the browser. `SUPABASE_SERVICE_ROLE_KEY` is local-script-only.
- `data/` is git-ignored and holds the raw spreadsheet export with real personal finances. Never commit it
  and never paste its contents into code or tests.

## Conventions

- Explicit types over inferred ones on exported functions; no `any`.
- JSDoc/TSDoc summary on every exported function, component and module — in English. No inline comments;
  explanations live in the summary.
- Amounts are `numeric` in Postgres and arrive as **strings** in JS. Convert with `Number()` at the
  boundary and format through `src/lib/format.ts`; never do arithmetic on the raw string.
- Dates are `YYYY-MM-DD` strings end to end. Do not pass `Date` objects across the SSR/island boundary.
- Path alias `@/*` maps to `src/*`.
