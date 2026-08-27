create policy "participants_insert_event_access"
on public.participants
for insert
to authenticated
with check (public.can_access_event(event_id));
