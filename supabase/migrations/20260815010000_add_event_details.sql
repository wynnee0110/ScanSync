alter table public.events
  add column venue text not null default '',
  add column expected_attendees integer not null default 0
    check (expected_attendees >= 0);
