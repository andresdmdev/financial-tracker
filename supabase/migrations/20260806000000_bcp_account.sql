-- Adds the BCP dollar bank account.
--
-- Accounts have no creation UI: they are seeded once per user by
-- `seed_default_data`, so a new payment method is a migration. The function is
-- replaced whole rather than patched, and a backfill block adds the row to the
-- users that already exist — the same shape used when QuantFury and TrustWallet
-- were introduced.
--
-- `sort_order = 35` places it between Debit (30) and Cash (40), which is where a
-- bank account belongs in the list. It is `debit` and holds dollars, so it needs
-- no rate when its balance is declared.

create or replace function public.seed_default_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_savings_account_id uuid;
  v_food_category_id uuid;
begin
  insert into public.accounts (user_id, name, type, currency, is_savings, sort_order)
  values
    (p_user_id, 'Binance', 'crypto', 'USD', false, 10),
    (p_user_id, 'Credit Card', 'credit_card', 'USD', false, 20),
    (p_user_id, 'Debit', 'debit', 'VES', false, 30),
    (p_user_id, 'BCP', 'debit', 'USD', false, 35),
    (p_user_id, 'Cash', 'cash', 'USD', false, 40),
    (p_user_id, 'Deel', 'platform', 'USD', false, 50),
    (p_user_id, 'QuantFury', 'platform', 'USD', false, 60),
    (p_user_id, 'TrustWallet', 'crypto', 'USD', false, 70),
    (p_user_id, 'Ahorros', 'debit', 'USD', true, 80)
  on conflict do nothing;

  select id into v_savings_account_id
  from public.accounts
  where user_id = p_user_id and lower(name) = 'ahorros';

  insert into public.categories (user_id, name, kind, sort_order)
  values
    (p_user_id, 'Comida', 'expense', 10),
    (p_user_id, 'Vivienda', 'expense', 30),
    (p_user_id, 'Deuda', 'expense', 40),
    (p_user_id, 'Ropa', 'expense', 50),
    (p_user_id, 'Tecnología', 'expense', 60),
    (p_user_id, 'Transporte', 'expense', 70),
    (p_user_id, 'Educación', 'expense', 80),
    (p_user_id, 'Inversión', 'expense', 90),
    (p_user_id, 'Salud', 'expense', 100),
    (p_user_id, 'Otros', 'expense', 999),
    (p_user_id, 'Sueldo', 'income', 10)
  on conflict do nothing;

  select id into v_food_category_id
  from public.categories
  where user_id = p_user_id and lower(name) = 'comida';

  insert into public.categories (user_id, name, kind, parent_id, sort_order)
  values (p_user_id, 'Proteína', 'expense', v_food_category_id, 20)
  on conflict do nothing;

  insert into public.savings_goals (user_id, name, account_id)
  values
    (p_user_id, 'Macbook', v_savings_account_id),
    (p_user_id, 'Carro', v_savings_account_id),
    (p_user_id, 'Moto', v_savings_account_id),
    (p_user_id, 'Apartamento', v_savings_account_id)
  on conflict do nothing;
end;
$$;

comment on function public.seed_default_data is
  'Creates the starting accounts, categories and goals for a newly created user.';

-- Backfills the users seeded before BCP existed.
do $$
declare
  v_user record;
begin
  for v_user in select distinct user_id from public.accounts loop
    insert into public.accounts (user_id, name, type, currency, is_savings, sort_order)
    values (v_user.user_id, 'BCP', 'debit', 'USD', false, 35)
    on conflict do nothing;
  end loop;
end;
$$;
