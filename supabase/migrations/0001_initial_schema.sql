create extension if not exists pgcrypto;

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  status text not null default 'active' check (status in ('active', 'completed')),
  source_data jsonb not null,
  document_version integer not null default 1 check (document_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create table public.authorized_users (
  email text primary key check (email = lower(email) and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('organizer', 'admin')),
  created_at timestamptz not null default now(),
  created_by_email text,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.current_user_email_verified()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'email_verified')::boolean, (auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false)
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.current_user_email_verified() then 'visitor'
    else coalesce((select role from public.authorized_users where email = public.current_user_email()), 'visitor')
  end
$$;

create or replace function public.is_organizer_or_admin()
returns boolean
language sql
stable
as $$ select public.current_user_role() in ('organizer', 'admin') $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$ select public.current_user_role() = 'admin' $$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leagues_touch_updated_at before update on public.leagues for each row execute function public.touch_updated_at();
create trigger authorized_users_touch_updated_at before update on public.authorized_users for each row execute function public.touch_updated_at();

create or replace function public.guard_authorized_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count integer;
  actor_email text;
begin
  actor_email := public.current_user_email();

  if tg_op in ('INSERT', 'UPDATE') then
    new.email := lower(new.email);
  end if;

  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin' and old.email = actor_email then
    raise exception 'Admins cannot downgrade themselves';
  end if;

  if tg_op = 'DELETE' and old.role = 'admin' and old.email = actor_email then
    raise exception 'Admins cannot remove themselves';
  end if;

  if (tg_op = 'DELETE' and old.role = 'admin') or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    select count(*) into admin_count from public.authorized_users where role = 'admin' and email <> old.email;
    if admin_count < 1 then
      raise exception 'Gones must keep at least one Admin User';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger authorized_users_guard before insert or update or delete on public.authorized_users for each row execute function public.guard_authorized_users();

create view public.public_leagues as
select id, name, status, source_data, document_version, created_at, updated_at
from public.leagues;

revoke all on public.leagues from anon, authenticated;
revoke all on public.authorized_users from anon, authenticated;
grant select on public.public_leagues to anon, authenticated;
grant insert, update, delete on public.leagues to authenticated;
grant select, insert, update, delete on public.authorized_users to authenticated;

alter table public.leagues enable row level security;
alter table public.authorized_users enable row level security;

create policy "public can read league rows through public-safe view" on public.leagues for select using (true);
create policy "organizers can insert leagues" on public.leagues for insert with check (public.is_organizer_or_admin());
create policy "organizers can update leagues" on public.leagues for update using (public.is_organizer_or_admin()) with check (public.is_organizer_or_admin());
create policy "organizers can delete leagues" on public.leagues for delete using (public.is_organizer_or_admin());

create policy "signed users can read their authorization role" on public.authorized_users for select using (public.is_admin() or email = public.current_user_email());
create policy "admins can insert authorized users" on public.authorized_users for insert with check (public.is_admin());
create policy "admins can update authorized users" on public.authorized_users for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete authorized users" on public.authorized_users for delete using (public.is_admin());
