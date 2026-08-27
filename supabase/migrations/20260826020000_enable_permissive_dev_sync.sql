-- Permissive RLS policies for development sync testing
-- Allows authenticated and public sync of events, participants, and attendance records

drop policy if exists "dev_allow_all_organizations" on public.organizations;
create policy "dev_allow_all_organizations" on public.organizations for all using (true) with check (true);

drop policy if exists "dev_allow_all_profiles" on public.profiles;
create policy "dev_allow_all_profiles" on public.profiles for all using (true) with check (true);

drop policy if exists "dev_allow_all_memberships" on public.memberships;
create policy "dev_allow_all_memberships" on public.memberships for all using (true) with check (true);

drop policy if exists "dev_allow_all_events" on public.events;
create policy "dev_allow_all_events" on public.events for all using (true) with check (true);

drop policy if exists "dev_allow_all_participants" on public.participants;
create policy "dev_allow_all_participants" on public.participants for all using (true) with check (true);

drop policy if exists "dev_allow_all_attendance" on public.attendance_records;
create policy "dev_allow_all_attendance" on public.attendance_records for all using (true) with check (true);
