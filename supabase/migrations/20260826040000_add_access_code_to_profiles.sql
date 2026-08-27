-- Add access_code column to public.profiles for persistent access code sync
alter table public.profiles
add column if not exists access_code text;

comment on column public.profiles.access_code is 'Persistent generated operator access passcode for offline and cloud auth';
