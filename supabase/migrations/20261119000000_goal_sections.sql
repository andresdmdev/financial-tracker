-- Work sections of a savings goal ("Impermeabilización del techo").
--
-- A goal such as a house renovation bundles several distinct jobs. Each job is
-- a section: a markdown document with the plan and budget, plus tasks of its
-- own that never mix with the goal's general task list.
--
-- Only the owner writes sections; a guest of the goal reads them and has full
-- use of their tasks, exactly as with the general tasks. Sections are removed
-- logically so the tasks hanging from them are never lost.
--
-- A task's section must belong to the same goal. A composite foreign key
-- enforces that in the database rather than trusting the route, and the task
-- trigger freezes `section_id` so a task cannot be moved between sections.

create table public.goal_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.savings_goals (id) on delete cascade,
  title text not null,
  content_md text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint goal_sections_title_length check (length(btrim(title)) between 1 and 80),
  constraint goal_sections_content_length check (length(content_md) <= 50000),
  constraint goal_sections_id_goal_unique unique (id, goal_id)
);

create index goal_sections_goal_idx
  on public.goal_sections (goal_id, sort_order, created_at)
  where deleted_at is null;

comment on table public.goal_sections is
  'A job within a goal: a markdown document plus its own tasks. Owner-written, guest-readable, soft-deleted.';

create or replace function public.set_goal_section_audit()
returns trigger
language plpgsql
as $$
begin
  if old.deleted_at is not null then
    raise exception 'La sección fue eliminada y no se puede modificar'
      using errcode = '23514';
  end if;

  new.user_id := old.user_id;
  new.goal_id := old.goal_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.deleted_at is not null then
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

comment on function public.set_goal_section_audit is
  'Freezes ownership, goal and creation time, and refuses any change to a deleted section.';

create trigger goal_sections_set_audit
  before update on public.goal_sections
  for each row execute function public.set_goal_section_audit();

alter table public.goal_sections enable row level security;

create policy goal_sections_owner_all on public.goal_sections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy goal_sections_member_select on public.goal_sections
  for select to authenticated
  using (
    goal_id in (
      select s.goal_id
      from public.goal_shares s
      where s.member_email = (select lower(auth.jwt() ->> 'email'))
    )
  );

-- ---------------------------------------------------------------------------
-- goal_tasks: optional section, same goal, frozen once set
-- ---------------------------------------------------------------------------

alter table public.goal_tasks
  add column section_id uuid,
  add constraint goal_tasks_section_same_goal
    foreign key (section_id, goal_id)
    references public.goal_sections (id, goal_id)
    on delete cascade;

create index goal_tasks_section_idx
  on public.goal_tasks (section_id, priority, created_at)
  where deleted_at is null and section_id is not null;

comment on column public.goal_tasks.section_id is
  'Section the task belongs to; null for the goal''s general tasks. Frozen after insert.';

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
    new.section_id := old.section_id;
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

  if new.section_id is not null and exists (
    select 1 from public.goal_sections gs
    where gs.id = new.section_id and gs.deleted_at is not null
  ) then
    raise exception 'La sección fue eliminada' using errcode = '23514';
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
  'Stamps the author on insert and freezes ownership, goal, section, author and creation time on '
  'update. Records who soft-deleted a task, refuses any change to one already deleted, and refuses '
  'new tasks in a deleted section.';
