-- Makes the spreadsheet-import idempotency index usable as an ON CONFLICT target.
--
-- The original index was partial (`where source_row_hash is not null`), and
-- Postgres refuses a partial unique index as a conflict target unless the
-- statement repeats the same predicate — which PostgREST cannot express. The
-- predicate was never needed: a unique index treats NULLs as distinct by
-- default, so rows created in the app (which carry no hash) still never
-- collide with one another.

drop index if exists public.transactions_source_row_hash_key;

create unique index transactions_source_row_hash_key
  on public.transactions (user_id, source_row_hash);
