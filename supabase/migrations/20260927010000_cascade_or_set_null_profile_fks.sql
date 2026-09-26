-- Migration: 20260927010000_cascade_or_set_null_profile_fks.sql
-- Description: Allow deleting operator profiles and auth users without 409 Conflict
--              by making audit/attribution foreign key columns nullable with ON DELETE SET NULL.

-- 1. Events: preserve events when creator operator is deleted
alter table public.events alter column created_by drop not null;
alter table public.events drop constraint if exists events_created_by_fkey;
alter table public.events
  add constraint events_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- 2. Attendance Records: preserve historical attendance records when scanning operator is deleted
alter table public.attendance_records alter column recorded_by drop not null;
alter table public.attendance_records drop constraint if exists attendance_records_recorded_by_fkey;
alter table public.attendance_records
  add constraint attendance_records_recorded_by_fkey
  foreign key (recorded_by) references public.profiles(id) on delete set null;

-- 3. Event Volunteers: preserve volunteer assignments when assigning organizer is deleted
alter table public.event_volunteers alter column assigned_by drop not null;
alter table public.event_volunteers drop constraint if exists event_volunteers_assigned_by_fkey;
alter table public.event_volunteers
  add constraint event_volunteers_assigned_by_fkey
  foreign key (assigned_by) references public.profiles(id) on delete set null;

-- 4. Export Jobs: preserve export jobs when requester is deleted
alter table public.export_jobs alter column requested_by drop not null;
alter table public.export_jobs drop constraint if exists export_jobs_requested_by_fkey;
alter table public.export_jobs
  add constraint export_jobs_requested_by_fkey
  foreign key (requested_by) references public.profiles(id) on delete set null;

-- 5. Invitations: preserve invitations when inviter is deleted
alter table public.invitations alter column invited_by drop not null;
alter table public.invitations drop constraint if exists invitations_invited_by_fkey;
alter table public.invitations
  add constraint invitations_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete set null;
