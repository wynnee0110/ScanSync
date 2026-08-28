"""
operator_service.py
-------------------
Privileged backend service for fetching, creating, and revoking operators in Supabase DB.
"""

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _get_supabase_client(config):
    from supabase import create_client
    return create_client(config.supabase_url, config.supabase_service_role_key)


def fetch_all_operators(
    config, created_by: str | None = None, actor_id: str | None = None
) -> List[Dict[str, Any]]:
    client = _get_supabase_client(config)

    # Auth is the source of truth for an operator account.  Profiles can remain
    # after failed development syncs, but must never become dashboard accounts.
    try:
        auth_users_resp = client.auth.admin.list_users()
        auth_users = auth_users_resp if isinstance(auth_users_resp, list) else getattr(auth_users_resp, "users", [])
    except Exception as auth_err:
        raise RuntimeError("Could not load Supabase Auth users") from auth_err

    try:
        profiles_resp = client.table("profiles").select(
            "id, full_name, email, access_code, created_at"
        ).execute()
        profiles_by_id = {str(profile["id"]): profile for profile in (profiles_resp.data or [])}
    except Exception as exc:
        raise RuntimeError("Could not load operator profiles") from exc

    profiles = []
    for au in auth_users:
        au_id = str(getattr(au, "id", ""))
        if not au_id:
            continue
        au_email = getattr(au, "email", "") or ""
        meta = getattr(au, "user_metadata", {}) or {}
        profile = profiles_by_id.get(au_id, {})
        profiles.append({
            "id": au_id,
            "full_name": profile.get("full_name") or meta.get("full_name") or au_email.split("@")[0],
            "email": au_email,
            "access_code": profile.get("access_code") or meta.get("access_code") or "",
            "created_at": profile.get("created_at") or getattr(au, "created_at", None),
            "user_metadata": meta,
        })

    memberships = []
    try:
        memberships_resp = client.table("memberships").select("user_id, role, organization_id").execute()
        memberships = memberships_resp.data or []
    except Exception as e:
        logger.warning("Notice fetching memberships: %s", e)

    volunteers = []
    try:
        volunteers_resp = client.table("event_volunteers").select("user_id, event_id, assigned_by").execute()
        volunteers = volunteers_resp.data or []
    except Exception as e:
        logger.warning("Notice fetching volunteers: %s", e)

    events = []
    try:
        events_resp = client.table("events").select("id, name, created_by").execute()
        events = events_resp.data or []
    except Exception as e:
        logger.warning("Notice fetching events: %s", e)


    operators = []
    events_map = {e["id"]: e.get("name") or e.get("title") or "Assigned Event" for e in events}

    for p in profiles:
        user_id = p["id"]
        meta = p.get("user_metadata", {})
        membership = next((m for m in memberships if m.get("user_id") == user_id), None)
        volunteer = next((v for v in volunteers if v.get("user_id") == user_id), None)

        role = "Volunteer"
        if membership and membership.get("role") == "superadmin":
            role = "Superadmin"
        elif membership and membership.get("role") == "organizer":
            role = "Organizer"

        assigned_event_id = volunteer.get("event_id") if volunteer else None
        if role == "Superadmin":
            assigned_event_name = "All Events (Superadmin)"
        elif assigned_event_id:
            assigned_event_name = events_map.get(assigned_event_id, "Assigned Event")
        else:
            assigned_event_name = "No Event Assigned"

        name = p.get("full_name") or p["email"].split("@")[0]
        email = p["email"]
        saved_code = p.get("access_code") or ""
        op_created_by = meta.get("created_by") or p.get("created_by") or (volunteer.get("assigned_by") if volunteer else None)

        operators.append({
            "id": user_id,
            "name": name,
            "email": email,
            "role": role,
            "assignedEventId": assigned_event_id,
            "assignedEventName": assigned_event_name,
            "generatedPasswordCode": saved_code,
            "scansCount": 0,
            "createdAt": p.get("created_at"),
            "createdBy": op_created_by,
        })

    if actor_id:
        actor_memberships = [m for m in memberships if m.get("user_id") == actor_id]
        actor_role = next((m.get("role") for m in actor_memberships if m.get("role") == "superadmin"), None)
        if actor_role != "superadmin":
            actor_role = next((m.get("role") for m in actor_memberships if m.get("role") == "organizer"), None)
        if actor_role == "organizer":
            organizer_event_ids = {e["id"] for e in events if e.get("created_by") == actor_id}
            operators = [
                op for op in operators
                if op["role"] == "Volunteer" and op.get("assignedEventId") in organizer_event_ids
            ]
        elif actor_role != "superadmin":
            raise PermissionError("Operator management requires superadmin or organizer access.")

    if created_by:
        target_cb = created_by.strip().lower()
        organizer_event_ids = {e["id"] for e in events if e.get("created_by") and str(e.get("created_by")).strip().lower() == target_cb}
        operators = [
            op for op in operators
            if op["role"] == "Volunteer" and (
                (op.get("createdBy") and str(op["createdBy"]).strip().lower() == target_cb) or
                (op.get("assignedEventId") in organizer_event_ids)
            )
        ]

    return operators




def create_or_update_operator(config, data: Dict[str, Any]) -> Dict[str, Any]:
    import uuid
    client = _get_supabase_client(config)
    user_id = data.get("id") or str(uuid.uuid4())
    email = data["email"]
    name = data["name"]
    role = data["role"]
    access_code = data.get("password") or data.get("generatedPasswordCode") or "VOL-4821"
    assigned_event_id = data.get("assignedEventId")
    created_by = data.get("createdBy")

    auth_user_id = None
    # 1. Create or lookup user in Supabase Auth via Service Role Admin API
    try:
        auth_res = None
        try:
            auth_res = client.auth.admin.create_user({
                "email": email,
                "password": access_code,
                "email_confirm": True,
                "user_metadata": {
                    "full_name": name,
                    "role": role,
                    "access_code": access_code,
                    "created_by": created_by,
                    "assigned_event_id": assigned_event_id,
                },
            })
        except Exception as dict_err:
            logger.info("Dict create_user notice, trying kwarg create_user: %s", dict_err)
            auth_res = client.auth.admin.create_user(
                email=email,
                password=access_code,
                email_confirm=True,
                user_metadata={
                    "full_name": name,
                    "role": role,
                    "access_code": access_code,
                    "created_by": created_by,
                    "assigned_event_id": assigned_event_id,
                },
            )

        if auth_res:
            if hasattr(auth_res, "user") and auth_res.user and hasattr(auth_res.user, "id"):
                auth_user_id = str(auth_res.user.id)
            elif hasattr(auth_res, "id") and auth_res.id:
                auth_user_id = str(auth_res.id)
            elif isinstance(auth_res, dict):
                auth_user_id = auth_res.get("id") or (auth_res.get("user", {}).get("id") if isinstance(auth_res.get("user"), dict) else None)
    except Exception as exc:
        logger.info("Notice create_user in Supabase Auth (user may already exist): %s", exc)

    if not auth_user_id:
        try:
            users_resp = client.auth.admin.list_users()
            users_list = users_resp if isinstance(users_resp, list) else getattr(users_resp, "users", [])
            for u in users_list:
                u_email = getattr(u, "email", "") or (u.get("email") if isinstance(u, dict) else "")
                if u_email and u_email.lower() == email.lower():
                    auth_user_id = str(getattr(u, "id", "") or (u.get("id") if isinstance(u, dict) else ""))
                    try:
                        client.auth.admin.update_user_by_id(auth_user_id, {
                            "password": access_code,
                            "user_metadata": {
                                "full_name": name,
                                "role": role,
                                "access_code": access_code,
                                "created_by": created_by,
                                "assigned_event_id": assigned_event_id,
                            },
                        })
                    except Exception:
                        pass
                    break
        except Exception as e2:
            logger.warning("Notice listing auth users: %s", e2)

    if auth_user_id:
        user_id = auth_user_id

    # 2. Upsert profile fields (email, access_code, full_name) with official Auth user_id
    try:
        client.table("profiles").upsert({
            "id": user_id,
            "full_name": name,
            "email": email,
            "access_code": access_code,
        }, on_conflict="id").execute()
    except Exception as e:
        logger.warning("Notice profiles upsert: %s", e)


    # Resolve the organization for memberships, creating the initial one after
    # a development reset when no organization exists yet.
    default_org_id = "00000000-0000-0000-0000-000000000001"
    try:
        org_resp = client.table("organizations").select("id").limit(1).execute()
        if org_resp.data and len(org_resp.data) > 0:
            default_org_id = org_resp.data[0]["id"]
        else:
            client.table("organizations").upsert({
                "id": default_org_id,
                "name": "ICpEP.SE Organization",
                "slug": "icpep-se",
            }, on_conflict="slug").execute()
            created_org = client.table("organizations").select("id").eq(
                "slug", "icpep-se"
            ).single().execute()
            default_org_id = created_org.data["id"]
    except Exception as e_org:
        raise RuntimeError("Could not create the operator organization") from e_org

    from datetime import datetime, timedelta, timezone
    valid_until_iso = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    # 3. Role-based database table linkage
    if role in ["Superadmin", "Organizer"]:
        app_role = "superadmin" if role == "Superadmin" else "organizer"
        try:
            client.table("memberships").upsert({
                "organization_id": default_org_id,
                "user_id": user_id,
                "role": app_role,
            }, on_conflict="organization_id,user_id").execute()
        except Exception as e:
            raise RuntimeError("Could not assign the operator role") from e
    elif role == "Volunteer" and assigned_event_id:
        try:
            client.table("event_volunteers").upsert({
                "event_id": assigned_event_id,
                "user_id": user_id,
                "assigned_by": created_by or user_id,
                "valid_until": valid_until_iso,
            }, on_conflict="event_id,user_id").execute()
        except Exception as e:
            logger.warning("Notice volunteer assignment upsert: %s", e)

    return {"status": "ok", "id": user_id}



def delete_operator(config, user_id: str) -> Dict[str, Any]:
    client = _get_supabase_client(config)
    target_email = None

    try:
        prof_resp = client.table("profiles").select("id, email").eq("id", user_id).execute()
        if prof_resp.data:
            target_email = prof_resp.data[0].get("email")
    except Exception:
        pass

    # 1. Delete from event_volunteers
    try:
        client.table("event_volunteers").delete().eq("user_id", user_id).execute()
    except Exception:
        pass

    # 2. Delete from memberships
    try:
        client.table("memberships").delete().eq("user_id", user_id).execute()
    except Exception:
        pass

    # 3. Delete from profiles
    try:
        client.table("profiles").delete().eq("id", user_id).execute()
        if target_email:
            client.table("profiles").delete().eq("email", target_email).execute()
    except Exception:
        pass

    # 4. Delete from Supabase Auth admin API
    try:
        client.auth.admin.delete_user(user_id)
    except Exception as exc:
        logger.info("Notice delete_user in Supabase Auth: %s", exc)

    if target_email:
        try:
            users_list = client.auth.admin.list_users()
            users = users_list if isinstance(users_list, list) else getattr(users_list, "users", [])
            for u in users:
                if getattr(u, "email", "").lower() == target_email.lower():
                    try:
                        client.auth.admin.delete_user(u.id)
                    except Exception:
                        pass
        except Exception as auth_err:
            logger.info("Notice deleting auth user by email: %s", auth_err)

    return {"status": "deleted", "id": user_id}
