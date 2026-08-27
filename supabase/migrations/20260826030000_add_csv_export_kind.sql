-- Migration: 20260826030000_add_csv_export_kind.sql
--
-- Adds 'csv' as a valid export kind so the export_jobs table can track
-- CSV exports in addition to 'pdf' and 'spreadsheet'.
--
-- Also adds an idempotency_key column to export_jobs so the FastAPI backend
-- can safely handle duplicate export requests (e.g. double-tap on mobile).
-- The column is nullable to keep existing rows valid without a backfill.

alter type public.export_kind add value if not exists 'csv';

alter table public.export_jobs
  add column if not exists idempotency_key uuid unique;

comment on column public.export_jobs.idempotency_key is
  'Client-generated idempotency key. Duplicate requests with the same key
   return the existing job instead of creating a new one.';

-- Index for fast idempotency lookup.
create index if not exists export_jobs_idempotency_idx
  on public.export_jobs(idempotency_key)
  where idempotency_key is not null;
