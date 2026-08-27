alter table public.events
  add column academic_reference_year smallint;

update public.events
set academic_reference_year = extract(year from starts_at)::smallint
where academic_reference_year is null;

alter table public.events
  alter column academic_reference_year set not null,
  add constraint events_academic_reference_year_check
    check (academic_reference_year between 1900 and 9999);
