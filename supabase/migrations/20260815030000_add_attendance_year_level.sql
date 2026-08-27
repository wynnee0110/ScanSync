alter table public.attendance_records
  add column year_level smallint;

alter table public.attendance_records
  add constraint attendance_records_year_level_range
  check (year_level between 1 and 4);

create index attendance_event_year_level_idx
  on public.attendance_records(event_id, year_level);

comment on column public.attendance_records.year_level is
  'Attendee year level selected at check-in. Values are 1 through 4; legacy rows may be null.';
