-- Add email column to public.profiles for persistent access email sync
alter table public.profiles
add column if not exists email text;

comment on column public.profiles.email is 'Persistent operator access email address';
