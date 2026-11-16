-- Tasks attached to a savings goal ("cotizar tres concesionarios").
--
-- A guest with a share has full use of a goal's tasks: it can read, create,
-- edit and remove them. Removal is therefore logical — `deleted_at` hides the
-- row — so nothing a guest does is unrecoverable, and the audit columns record
-- who did it. There is no delete policy for guests at all; the owner keeps one
-- only because `for all` is the house pattern, and the app never uses it.
--
-- As with transactions, the row belongs to the owner (`user_id`) whoever wrote
-- it, and the author is stamped from the JWT by trigger rather than trusted
-- from the client.

create type public.goal_task_status as enum ('pending', 'in_progress', 'completed');

create table public.goal_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.savings_goals (id) on delete cascade,
  title text not null,
  description text,
  tag text,
  priority smallint not null default 2,
  status public.goal_task_status not null default 'pending',
  completed_on date,
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_email text,
  constraint goal_tasks_title_length check (length(btrim(title)) between 1 and 120),
  constraint goal_tasks_description_length
    check (description is null or length(btrim(description)) between 1 and 1000),
  constraint goal_tasks_tag_length check (tag is null or length(btrim(tag)) between 1 and 30),
  constraint goal_tasks_priority_range check (priority between 1 and 3),
  constraint goal_tasks_completed_on_matches_status
    check ((status = 'completed') = (completed_on is not null))
);

create index goal_tasks_goal_priority_idx
  on public.goal_tasks (goal_id, priority, created_at)
  where deleted_at is null;

comment on table public.goal_tasks is
  'To-do items of a savings goal. Soft-deleted through deleted_at; guests share full use of them.';
comment on column public.goal_tasks.priority is '1 = alta, 2 = media, 3 = baja. Sorts ascending.';
comment on column public.goal_tasks.completed_on is
  'Day the task was completed, in the browser''s calendar. Set exactly when status = completed.';
comment on column public.goal_tasks.deleted_at is
  'Logical deletion. A deleted task is hidden from the app and can no longer be edited.';

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_goal_task_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then
      raise exception 'La tarea fue eliminada y no se puede modificar'
        using errcode = '23514';
    end if;

    new.user_id := old.user_id;
    new.goal_id := old.goal_id;
    new.created_by_email := old.created_by_email;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
    new.updated_at := now();

    if new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by_email := lower(auth.jwt() ->> 'email');
    else
      new.deleted_by_email := null;
    end if;

    return new;
  end if;

  new.deleted_at := null;
  new.deleted_by_email := null;
  new.created_by_email := lower(auth.jwt() ->> 'email');
  new.created_by_name := null;

  if new.created_by_email is null then
    return new;
  end if;

  new.created_by_name := (
    select s.member_name
    from public.goal_shares s
    where s.goal_id = new.goal_id
      and s.member_email = new.created_by_email
  );

  if new.created_by_name is null then
    new.created_by_name := (
      select coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
      from auth.users u
      where u.id = auth.uid()
        and u.id = new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.set_goal_task_audit is
  'Stamps the author on insert and freezes ownership, author and creation time on update. '
  'Records who soft-deleted a task and refuses any change to one already deleted.';

create trigger goal_tasks_set_audit
  before insert or update on public.goal_tasks
  for each row execute function public.set_goal_task_audit();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.goal_tasks enable row level security;

create policy goal_tasks_owner_all on public.goal_tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy goal_tasks_member_select on public.goal_tasks
  for select to authenticated
  using (
    goal_id in (
      select s.goal_id
      from public.goal_shares s
      where s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  );

create policy goal_tasks_member_insert on public.goal_tasks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.goal_shares s
      where s.goal_id = goal_tasks.goal_id
        and s.user_id = goal_tasks.user_id
        and s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  );

create policy goal_tasks_member_update on public.goal_tasks
  for update to authenticated
  using (
    goal_id in (
      select s.goal_id
      from public.goal_shares s
      where s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  )
  with check (
    exists (
      select 1
      from public.goal_shares s
      where s.goal_id = goal_tasks.goal_id
        and s.user_id = goal_tasks.user_id
        and s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  );
