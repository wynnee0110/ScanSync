-- Security Definer function to bootstrap initial organization, profile, and superadmin membership
create or replace function public.bootstrap_user_organization()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_org_id uuid := '00000000-0000-0000-0000-000000000001';
  current_user_id uuid := auth.uid();
  user_email text;
  existing_org_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Get email of calling authenticated user
  select email into user_email from auth.users where id = current_user_id;

  -- 1. Ensure default organization exists
  insert into public.organizations (id, name, slug)
  values (default_org_id, 'ICpEP.SE Organization', 'icpep-se')
  on conflict (slug) do nothing;

  select id into existing_org_id from public.organizations limit 1;
  if existing_org_id is not null then
    default_org_id := existing_org_id;
  end if;

  -- 2. Ensure profile exists in public.profiles
  insert into public.profiles (id, full_name, email)
  values (
    current_user_id,
    coalesce(split_part(user_email, '@', 1), 'Operator'),
    coalesce(user_email, 'operator@icpep.se')
  )
  on conflict (id) do nothing;

  -- 3. Ensure membership exists with superadmin role
  insert into public.memberships (organization_id, user_id, role)
  values (default_org_id, current_user_id, 'superadmin'::public.app_role)
  on conflict (organization_id, user_id) do nothing;

  return default_org_id;
end;
$$;

revoke all on function public.bootstrap_user_organization() from public;
grant execute on function public.bootstrap_user_organization() to authenticated;
