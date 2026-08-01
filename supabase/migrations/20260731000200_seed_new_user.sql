-- Seeds a fresh user with the accounts, categories and savings goals derived
-- from the original Google Sheets workbook.
--
-- Done as a trigger rather than a static seed file because every row is scoped
-- by user_id and that id only exists once the account is created. It also means
-- a local `supabase db reset` produces the same starting point as production.

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
  insert into public.accounts (user_id, name, type, is_savings, sort_order)
  values
    (p_user_id, 'Binance', 'crypto', false, 10),
    (p_user_id, 'Credit Card', 'credit_card', false, 20),
    (p_user_id, 'Debit', 'debit', false, 30),
    (p_user_id, 'Cash', 'cash', false, 40),
    (p_user_id, 'Deel', 'platform', false, 50),
    (p_user_id, 'Ahorros', 'debit', true, 60)
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_data(new.id);
  return new;
end;
$$;

comment on function public.handle_new_user is
  'Runs seed_default_data when an auth user is created.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
