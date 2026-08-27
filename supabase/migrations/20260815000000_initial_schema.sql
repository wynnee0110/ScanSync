create extension if not exists pgcrypto;

create type public.app_role as enum ('superadmin', 'organizer', 'volunteer');
create type public.event_status as enum ('draft', 'active', 'completed', 'archived');
create type public.attendance_method as enum ('qr', 'manual');
create type public.export_kind as enum ('pdf', 'spreadsheet');
create type public.job_status as enum ('queued', 'processing', 'completed', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'volunteer',
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.event_status not null default 'draft',
  drive_folder_id text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create table public.event_volunteers (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  valid_until timestamptz not null,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  external_reference text,
  display_name text not null,
  email text,
  qr_identifier_hash text not null,
  created_at timestamptz not null default now(),
  unique (event_id, qr_identifier_hash),
  unique (event_id, external_reference)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id),
  method public.attendance_method not null,
  recorded_at timestamptz not null,
  client_record_id uuid not null unique,
  device_id text,
  received_at timestamptz not null default now(),
  unique (event_id, participant_id)
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  kind public.export_kind not null,
  status public.job_status not null default 'queued',
  requested_by uuid not null references public.profiles(id),
  drive_file_id text,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger events_set_updated_at
  before update on public.events
  for each row execute procedure public.set_updated_at();

create index memberships_user_idx on public.memberships(user_id);
create index events_organization_idx on public.events(organization_id, starts_at desc);
create index event_volunteers_user_idx on public.event_volunteers(user_id, valid_until);
create index participants_event_idx on public.participants(event_id);
create index attendance_event_time_idx on public.attendance_records(event_id, recorded_at desc);
create index export_jobs_event_idx on public.export_jobs(event_id, created_at desc);

create or replace function public.has_org_role(target_org uuid, accepted_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_org
      and membership.user_id = auth.uid()
      and membership.role = any(accepted_roles)
      and (membership.valid_until is null or membership.valid_until > now())
  );
$$;

create or replace function public.can_access_event(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events event
    where event.id = target_event
      and (
        public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
        or exists (
          select 1
          from public.event_volunteers assignment
          where assignment.event_id = event.id
            and assignment.user_id = auth.uid()
            and assignment.valid_until > now()
        )
      )
  );
$$;

revoke all on function public.has_org_role(uuid, public.app_role[]) from public;
revoke all on function public.can_access_event(uuid) from public;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.can_access_event(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.events enable row level security;
alter table public.event_volunteers enable row level security;
alter table public.participants enable row level security;
alter table public.attendance_records enable row level security;
alter table public.export_jobs enable row level security;

create policy "profiles_read_self" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "profiles_update_self" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "organizations_read_members" on public.organizations for select to authenticated
using (public.has_org_role(id, array['superadmin', 'organizer', 'volunteer']::public.app_role[]));

create policy "memberships_read_authorized" on public.memberships for select to authenticated
using (
  user_id = auth.uid()
  or public.has_org_role(organization_id, array['superadmin', 'organizer']::public.app_role[])
);
create policy "memberships_manage_admins" on public.memberships for all to authenticated
using (public.has_org_role(organization_id, array['superadmin']::public.app_role[]))
with check (public.has_org_role(organization_id, array['superadmin']::public.app_role[]));

create policy "invitations_manage_organizers" on public.invitations for all to authenticated
using (public.has_org_role(organization_id, array['superadmin', 'organizer']::public.app_role[]))
with check (public.has_org_role(organization_id, array['superadmin', 'organizer']::public.app_role[]));

create policy "events_read_authorized" on public.events for select to authenticated
using (public.can_access_event(id));
create policy "events_create_organizers" on public.events for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_org_role(organization_id, array['superadmin', 'organizer']::public.app_role[])
);
create policy "events_update_organizers" on public.events for update to authenticated
using (public.has_org_role(organization_id, array['superadmin', 'organizer']::public.app_role[]))
with check (public.has_org_role(organization_id, array['superadmin', 'organizer']::public.app_role[]));

create policy "event_volunteers_read_authorized" on public.event_volunteers for select to authenticated
using (user_id = auth.uid() or public.can_access_event(event_id));
create policy "event_volunteers_manage_organizers" on public.event_volunteers for all to authenticated
using (
  exists (
    select 1 from public.events event
    where event.id = event_id
      and public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
  )
)
with check (
  exists (
    select 1 from public.events event
    where event.id = event_id
      and public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
  )
);

create policy "participants_read_event_access" on public.participants for select to authenticated
using (public.can_access_event(event_id));
create policy "participants_manage_organizers" on public.participants for all to authenticated
using (
  exists (
    select 1 from public.events event
    where event.id = event_id
      and public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
  )
)
with check (
  exists (
    select 1 from public.events event
    where event.id = event_id
      and public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
  )
);

create policy "attendance_read_event_access" on public.attendance_records for select to authenticated
using (public.can_access_event(event_id));
create policy "attendance_insert_event_access" on public.attendance_records for insert to authenticated
with check (recorded_by = auth.uid() and public.can_access_event(event_id));

create policy "export_jobs_read_organizers" on public.export_jobs for select to authenticated
using (
  exists (
    select 1 from public.events event
    where event.id = event_id
      and public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
  )
);
create policy "export_jobs_request_organizers" on public.export_jobs for insert to authenticated
with check (
  requested_by = auth.uid()
  and exists (
    select 1 from public.events event
    where event.id = event_id
      and public.has_org_role(event.organization_id, array['superadmin', 'organizer']::public.app_role[])
  )
);
