create policy "attendance_update_organizers"
on public.attendance_records
for update
to authenticated
using (
  exists (
    select 1
    from public.events event
    where event.id = attendance_records.event_id
      and public.has_org_role(
        event.organization_id,
        array['superadmin', 'organizer']::public.app_role[]
      )
  )
)
with check (
  exists (
    select 1
    from public.events event
    where event.id = attendance_records.event_id
      and public.has_org_role(
        event.organization_id,
        array['superadmin', 'organizer']::public.app_role[]
      )
  )
);

create policy "attendance_delete_organizers"
on public.attendance_records
for delete
to authenticated
using (
  exists (
    select 1
    from public.events event
    where event.id = attendance_records.event_id
      and public.has_org_role(
        event.organization_id,
        array['superadmin', 'organizer']::public.app_role[]
      )
  )
);
