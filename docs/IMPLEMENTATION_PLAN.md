# Implementation plan

## Assumptions to confirm before production

- One organization is expected initially, but the schema is organization-aware to avoid a later data migration.
- “Attendance” currently means one check-in per participant per event. Check-out, session attendance, and corrections require an explicit product rule.
- Volunteers use Supabase Auth and receive time-limited event assignments; Google/Gmail identity may be offered through Supabase social login later.
- Reports are generated on demand from Supabase and copied to Google Drive. Drive is not used as a live database.
- Expo SDK 54 is the temporary compatibility target for physical iPhone testing with the App Store version of Expo Go. Upgrade to the current SDK when a compatible Expo Go release or Apple-signed development build is available.

## Phase 1 — repository and offline-ready foundation (initialized)

- [x] Scaffold Expo Router + React Native + TypeScript.
- [x] Add Supabase client dependencies and public environment template.
- [x] Add SQLite local database and durable sync-outbox primitives.
- [x] Add a runnable dashboard/history shell with cloud/network status.
- [x] Migrate the prototype frontend (`rn-attendance-scanner`) into a 3-tab shell (Home / Scan / Profile) and refactor its Tailwind styles to React Native StyleSheet.
- [x] Integrate events, per-event detail, and attendance history into the Home tab.
- [x] Add an initial Supabase schema, indexes, RLS helpers, and policies.
- [x] Document the target architecture, security boundaries, and agent workflow.
- [ ] Connect a real Supabase project and generate database types (requires project credentials).
- [ ] Confirm Android device/emulator launch and iOS launch on an available device or macOS runner.

Exit criteria: the project installs cleanly, typechecks, lints, passes Expo Doctor, starts without credentials, and is ready for a GitHub remote.

## Phase 2 — authentication and authorization

- [x] Implement organizer and volunteer sign-in through Supabase Auth.
- [ ] Create the first organization and superadmin membership through a controlled bootstrap path.
- [x] Add session-aware route guards and sign-out.
- [ ] Implement invitation creation, acceptance, expiry, and revocation.
- [ ] Generate Supabase TypeScript types and repository interfaces.
- [ ] Test RLS for superadmin, organizer, assigned volunteer, expired volunteer, and unrelated user.

Exit criteria: users see only authorized organizations/events; expired or revoked access fails at the data layer.

## Phase 3 — event and participant management

- [x] Create events locally with active/draft status, venue, start time, end time, and expected attendance.
- [x] Store an explicit academic reference year on each event for deterministic cohort classification.
- [x] Enforce time-bounded volunteer access window (valid strictly between event start time and end time).
- [ ] Sync event creation to Supabase; add edit and archive operations.
- Import or manually create participant lists with validation and duplicate handling.
- [x] Assign volunteers to specific events with time-limited window validation (`startsAt` / `endsAt`).
- [x] Add a superadmin operators dashboard with live staff statistics, passcode controls, auto-generated access codes, and Superadmin role protection.
- [x] Add overall and per-event attendance statistics grouped from 1st through 4th year.
- [x] Define and validate the initial opaque QR payload format.
- [x] Parse the legacy university name, student ID, and program QR format as validated identity claims.
- [ ] Add server-issued QR regeneration and revocation.

Exit criteria: an organizer can prepare an event and a volunteer sees only the assigned active event.

## Phase 4 — offline attendance and synchronization

- [x] Add cross-platform camera permission flow and QR scanning for active events.
- [x] Persist extracted university QR identity claims locally and queue them for immediate sync.
- [x] Automatically derive 1st-through-4th-year classification for valid school IDs using the event academic reference year, with a safe confirmation fallback for unresolved references.
- [x] Add accessible manual lookup/input modal collecting Student Name, ID Number, and Course, recording manual check-ins locally with duplicate checks.
- [x] Write QR and manual attendance plus outbox entries atomically with duplicate prevention.
- [x] Implement connectivity-triggered and user-triggered sync.
- [x] Add exponential retry, dead-letter state, duplicate handling, and sync observability.
- [x] Add local attendance history with event filtering and pending/synced states.
- [x] Add guarded attendance correction and deletion flows with offline-safe outbox mutations.
- Test airplane-mode capture, app restart, repeated scan, expired access, and intermittent connectivity.

Exit criteria: attendance is never silently lost, replay is idempotent, and users can understand pending/conflicted items.

## Phase 5 — FastAPI reports and Google Drive

- [x] Scaffold FastAPI with health checks, structured configuration, Supabase JWT verification, and scoped authorization (`backend/main.py`, `backend/auth.py`, `backend/config.py`).
- [x] Implement idempotent CSV export jobs via `POST /export/csv` with per-job idempotency key (`backend/export_service.py`).
- [x] Configure Google OAuth and service-account Drive auth modes (`GOOGLE_DRIVE_AUTH_MODE` in `backend/.env`).
- [x] Create event folder and generate participant CSV from Supabase attendance snapshot; upload to Drive.
- [x] Store Drive file ID and export metadata in `export_jobs`; mobile surfaces result via Alert + Drive link.
- [x] Add `csv` to the `export_kind` enum and `idempotency_key` column to `export_jobs` (migration `20260826030000`).
- [x] Automate Google Drive CSV export generation and in-place file updates upon sync queue completion (`src/lib/sync-worker.ts`).
- [ ] Add PDF statistics report rendering (deferred — FastAPI scaffold complete).
- [ ] Add retry, audit logs without PII, and partial-failure recovery (future hardening).

Exit criteria: an authorized organizer can request an export and find both generated files in the correct Drive event folder.

## Phase 6 — hardening and release

- Add unit, repository, sync, RLS, and end-to-end tests.
- Add CI for typecheck, lint, tests, migration checks, Python checks, and secret scanning.
- Add error monitoring, privacy/retention rules, backups, and incident runbooks.
- Run accessibility, performance, offline endurance, and device-matrix testing.
- Configure EAS development/preview/production profiles and GitHub branch protection.

Exit criteria: documented release candidate with monitored mobile/API deployments, restore procedures, and signed stakeholder acceptance.
