# Attendance Manager progress report

**Snapshot date:** 2026-08-22

**Repository:** `https://github.com/yhnalx/icpep-scansync.git`

**Branch at review:** `main`

**HEAD at review:** `2827029` — `Frontend: Charts, Pagination, home card information. (#5)`

**Working tree before this documentation update:** clean

## 2026-09-26 Expo SDK 57 upgrade & online JWT re-validation update

- Upgraded application from Expo SDK 54 to Expo SDK 57 (`expo@^57.0.0`, `react-native@0.86.3`, `react@19.2.3`, `expo-router@~57.0.23`, `typescript@~6.0.3`).
- Updated and aligned all 30 Expo native modules via `npx expo install --fix`, adding required config plugins to `app.json`.
- Added `"dev": "expo start"` script to `package.json`.
- Resolved React Native 0.86 and React 19 compiler compatibility issues (`ColorSchemeName` typing in `useTheme`, `StyleSheet.absoluteFill` in `AnimatedSplashOverlay`, and React Compiler lint rules in `eslint.config.js`).
- Implemented automatic online JWT & session re-validation in `src/features/auth/auth-context.tsx`. Whenever device reconnects to internet or returns from mobile background (`AppState === 'active'`), token and active membership/volunteer status are validated against Supabase without disrupting offline usage.
- Added proactive token refresh (`getValidAccessToken`) in `src/lib/supabase.ts`, preventing HTTP 401 token expiration errors in `operator-store.ts` and `sync-worker.ts`.

## 2026-09-02 operator revocation deletion & session eviction update

- Fixed bug where revoking/deleting an operator did not purge the Supabase Auth user or kick the user out of the app.
- Updated `delete_operator` in `backend/operator_service.py` and `backend/main.py` to resolve and purge operator records from Supabase Auth (`client.auth.admin.delete_user`), `profiles`, `memberships`, and `event_volunteers` by both User ID and Email.
- Updated `removeOperator` and `deleteOperatorFromSupabase` in `src/features/operators/operator-store.ts` to capture operator metadata before store removal and pass both ID and Email to cloud deletion.
- Updated `src/features/auth/auth-context.tsx` so that local or Supabase Auth sessions belonging to revoked or deleted operator accounts immediately trigger `signOut()`, forcing `AuthGuard` to redirect the user to `/(auth)/login`.

## 2026-09-02 event creation ownership scoping update

- Fixed issue where events created by an Organizer logged in via Supabase Auth would disappear from the Organizer's event list after creation/sync.
- Added `isEventCreatedByUser` helper in `src/features/events/event-types.ts` that checks event ownership against both user email and Supabase user UUID (`user.id` / `localUser.id`).
- Updated event creation in `src/features/events/events-section.tsx` to set `createdBy` to `user.id || localUser.id || effectiveUserEmail`, matching Supabase remote schema.
- Updated event filtering in `events-section.tsx`, `home-screen.tsx`, `scanner-screen.tsx`, `history-section.tsx`, `event-detail-screen.tsx`, `operators-screen-dashboard.tsx`, and `user-detail-screen.tsx` to use `isEventCreatedByUser`.
- Added `created_by TEXT` directly to `local_events` `CREATE TABLE` definition in `src/lib/local-database.ts`.

## 2026-08-27 automated sync export integration update

- Removed manual export UI buttons to streamline the user workflow.
- Updated `processSyncQueue` in `src/lib/sync-worker.ts` to collect `syncedEventIds` and automatically trigger backend CSV generation for all synced events upon outbox replay completion.
- Re-syncing events (including after attendance record additions, updates, or deletions) automatically updates the existing event CSV file in-place on Google Drive (`upload_csv` using `files().update()`).
- Updated unit test suite (`src/lib/__tests__/sync-worker.web.test.ts`) to verify `syncedEventIds` behavior.

## 2026-08-27 operator dashboard integrity update

- Fixed the operator dashboard source so it uses only actual Supabase Auth users returned by the privileged backend. Orphaned `public.profiles` rows are no longer rendered as accounts, and fetching the dashboard no longer creates profiles as a side effect.
- A successful backend response, including an empty list, now replaces the device-cached operator list. This removes stale local dashboard entries after accounts are deleted remotely.
- After explicit confirmation, performed a complete reset of the configured Supabase project. Removed 3 Auth users and all rows from organizations, profiles, memberships, invitations, events, event volunteers, participants, attendance records, and export jobs. Post-reset verification returned zero rows for every table and zero Auth users.
- Restored the first superadmin through the privileged backend bootstrap flow. The reset-safe path now recreates the default organization before assigning the first `superadmin` membership.
- Operator accounts are now local-first: new or edited accounts remain in device storage until the Operators Dashboard cloud-upload action publishes them. Remote refreshes preserve those device-pending accounts. Authenticated operator reads are scoped to all organization accounts for superadmins and to volunteers assigned to an organizer's own events for organizers.
- Sync now requires an authenticated active membership and no longer creates placeholder users, organizations, or events. After a successful sync, CSV exports follow the same scope: superadmins export all organization events; organizers export only events they created.

## Executive summary

The project has a solid local-first Expo application and is suitable for continued feature development. The primary mobile workflows work against local persistence: event management, QR attendance, manual attendance check-in, required year-level classification, statistics, event analytics, operator management, and attendance history correction/deletion.

It is **not production-ready or cloud-connected yet**. Supabase authentication is mocked, the outbox has no real synchronization worker, the FastAPI backend is only a stub, and Google Drive report generation has not started.

The next development priority should be Supabase authentication and synchronization. Google Drive reports must consume a synchronized Supabase snapshot; implementing reports first would risk exporting incomplete data from one device.

## Current technology baseline

| Area | Current choice |
| --- | --- |
| Mobile | Expo SDK 57, React Native 0.86.3, React 19.2.3, TypeScript 6.0 |
| Navigation | Expo Router 57 |
| Native local data | `expo-sqlite` with WAL, foreign keys, and a durable mutation queue |
| Web preview data | Browser storage through platform-specific adapters |
| Scanner | `expo-camera` |
| Feedback | `expo-audio` success/failure sounds |
| Charts | `react-native-chart-kit` and `react-native-svg` |
| Cloud client | `@supabase/supabase-js`, currently unprovisioned |
| Tests | Vitest |
| Planned backend | FastAPI, not scaffolded |
| Planned reports | Statistical PDF plus participant XLSX uploaded to Google Drive |

## Implemented and functional locally

### Application shell

- Expo Router application with Home, Scan, and Profile tabs.
- Dedicated Events, Event Detail, Operators Dashboard, Operator Profile, Attendance History, and mock Login routes.
- Safe-area handling and an animated splash overlay.
- LAN-compatible Expo Go workflow for physical iOS testing.
- Android remains the intended production target.

### Event management & start/end times

- Create, edit, delete, and cycle event status locally.
- Event fields include name, venue, start time (`startsAt`), end time (`endsAt`), status, and expected attendance.
- Date, Start Time, and End Time selectors with validation (`endsAt > startsAt`).
- Schema migration adds `ends_at` column to `local_events` SQLite table with 4-hour fallback mapping for legacy rows.
- Each event stores an explicit academic reference year used to keep cohort calculations deterministic.
- Active events are available in the scanner destination selector.
- Dedicated event detail route at `/events/[id]`.
- Guarded event deletion with local cascade behavior and outbox mutation handling.
- Event capacity, total attendance, today's attendance, and pending-sync indicators.

### Operators dashboard & time-bounded access

- Dedicated Operators Dashboard route at `/operators`.
- Role-based filtering tabs (All, Admins, Organizers, Volunteers) with live staff counters.
- Time-bounded volunteer access status validation (`getOperatorAccessStatus`) comparing current timestamp against event `startsAt` and `endsAt` (`SCHEDULED`, `EXPIRED`, or `ACTIVE`).
- Superadmin protection: Superadmin accounts cannot be revoked or deleted (hidden remove actions and alert guards).
- Passcode visibility controls inside individual user detail profile screens (`/users/[id]`).
- Auto-generated unique access codes on operator creation.

### QR and manual attendance

- Camera permission request and QR scanning.
- Managed payload support: `attendance://participant/<opaque-id>`.
- Legacy university payload support: `name<TAB>10-digit-student-id<TAB>program`.
- Valid ten-digit school IDs automatically derive their year level from the entry-year prefix and selected event's academic reference year, then save without an extra tap.
- Manual entry sheet collects **Student Name**, **ID Number**, and **Course**, saving records directly to SQLite/Web Storage with `method: 'manual'`, automatic cohort derivation, duplicate checks, and event count updates.
- Duplicate prevention per event and participant reference.
- SQLite attendance write and sync-queue write in one transaction.
- Two-second scanner reset for continuous scanning.
- Success and failure audio feedback.

### Attendance history

- Strict event-scoped history view.
- Search by participant name, full student ID/reference, program, or event.
- Manual filters for year level and synchronization status.
- Ten-record pagination.
- Complete student ID/reference displayed in the interface.
- Edit name, ID/reference, program, and year level.
- Delete with explicit confirmation.
- Offline-safe queue rewriting/cancellation for attendance edits and deletes.

### Statistics and analytics

- Dashboard totals for attendees, today's attendance, events, and pending synchronization.
- Per-event attendee and capacity statistics.
- 1st–4th year counts with support for old unclassified records.
- Event analytics charts for scan times, timeline, cumulative attendance, capacity, year level, check-in method, and sync status.

### Persistence and schema foundation

- Native SQLite tables for local events, attendance records, preferences, and sync queue.
- Web adapters for local development/preview.
- Stable client-generated UUIDs.
- Queue statuses and retry metadata are modeled locally.
- Initial Supabase migrations include organizations, memberships, invitations, events, volunteers, participants, attendance, export jobs, indexes, helper functions, and RLS policies.
- Additional migrations cover event details, event academic reference year, participant program, attendance year level, and organizer update/delete policies.

## Partial implementations and placeholders

| Area | Present | Missing or misleading behavior |
| --- | --- | --- |
| Supabase client | Public environment wiring and session persistence | No real project credentials, generated types, bootstrap data, or verified remote reads/writes |
| Authentication | Mock username/password screen | No Supabase Auth, route guards, roles, invitation acceptance, expiry, or sign-out session flow |
| Sync queue | Durable local operations and pending counters | No worker that sends operations to Supabase; Sync buttons currently only show intent/refresh behavior |
| Manual entry | Sheet collecting Student Name, ID Number, Course | Records locally into SQLite/Web DB; cloud sync requires backend worker |
| Participant trust | Legacy payload validation | No roster import/matching or server-issued signed/opaque QR lifecycle |
| Backend | `backend/README.md` boundary | No FastAPI package, health endpoint, configuration, JWT validation, tests, worker, or deployment files |
| Participant trust | Legacy payload validation | No roster import/matching or server-issued signed/opaque QR lifecycle |
| Backend | `backend/README.md` boundary | No FastAPI package, health endpoint, configuration, JWT validation, tests, worker, or deployment files |
| Reports | Initial `export_jobs` table | No API, renderer, PDF/XLSX files, status UI, retry logic, or download/open actions |
| Google Drive | Target architecture and supplied folder | No Cloud project/API authorization, backend credential, folder resolver, upload code, or live test |
| Device validation | iOS LAN workflow documented | No recorded Android validation matrix; no macOS-native iOS build validation |

## Known documentation drift

- `UPDATE.md` is a historical 2026-08-15 snapshot. It states that changes were uncommitted, but the repository now has subsequent commits and a configured GitHub remote.
- The Home Sync alert says records will automatically synchronize, but no sync worker exists.
- The Event Detail Sync button simulates activity and reloads local data; it does not contact Supabase or FastAPI.

Agents should prefer current code, `AGENTS.md`, this report, and `docs/ARCHITECTURE.md` over older narrative summaries.

## Supabase integration gaps that must be resolved

1. Create/link a Supabase project and apply migrations in timestamp order.
2. Generate database TypeScript types from the linked project.
3. Bootstrap the first organization, user profile, and superadmin membership through a controlled path.
4. Replace mock credentials with Supabase Auth and add session-aware route guards.
5. Add organization and actor context to the local-to-remote event mapping. Remote events require `organization_id` and `created_by`, which local event rows currently do not contain.
6. Define participant upsert behavior. Local attendance stores identity claims, while remote attendance requires a `participant_id` and `recorded_by`.
7. Implement ordered outbox replay for event insert/update/delete and attendance insert/update/delete.
8. Add connectivity/manual triggers, bounded exponential retry, categorized conflicts, and visible failure/review states.
9. Test RLS and replay idempotency against a real Supabase project.

## Google Drive report handoff

The user supplied this intended Drive root folder:

- Folder URL: `https://drive.google.com/drive/folders/11ExxCW__8ROzle2Sfeda122SdDv5kQAK`
- Root folder ID: `11ExxCW__8ROzle2Sfeda122SdDv5kQAK`

The folder ID is an integration reference, not a credential. Do not assume the backend can write to it until Google API authorization is configured and tested.

### Recommended Drive design

- Prefer a dedicated Google Workspace Shared Drive controlled by the organization.
- Use a backend service account with explicit content-manager access when organization policy permits it.
- If the supplied folder is ordinary My Drive and service-account ownership is unsuitable, use server-side OAuth for a designated organization account instead.
- Store `GOOGLE_DRIVE_ROOT_FOLDER_ID` and Google credentials only in FastAPI/deployment secrets.
- Lazily create or resolve the event folder when Create Report is requested; do not create empty folders for every draft event.
- Identify folders/files using Drive IDs and private application properties, not display names.
- Suggested hierarchy:

```text
Attendance Manager Reports/
└── <year>/
    └── <event-date> - <event-name> [<event-short-id>]/
        ├── <event-name> - Attendance Summary - <timestamp>.pdf
        └── <event-name> - Participants - <timestamp>.xlsx
```

### Required export schema change

The current `export_jobs` table has one `kind` and one `drive_file_id`. The desired Create Report action produces both PDF and spreadsheet files. Add a forward-only migration that keeps one report job and stores its artifacts separately, for example:

```text
export_jobs
- id, event_id, status, requested_by
- idempotency_key, snapshot_at, attempt_count, error_code
- started_at, completed_at

export_artifacts
- id, export_job_id, kind, status
- drive_file_id, file_name, mime_type, checksum
- created_at, completed_at
```

### Intended report flow

1. An authenticated organizer opens an event and presses Create Report.
2. The app blocks the request if that event has pending mutations.
3. The app sends the Supabase access token and a client-generated idempotency key to FastAPI.
4. FastAPI validates JWT, organization membership, and event role.
5. A worker reads a consistent Supabase snapshot.
6. The worker resolves or creates the year and event folders in Drive.
7. It renders a statistical PDF and participant XLSX.
8. It creates or updates the two Drive files idempotently.
9. It stores artifact metadata in Supabase and marks the job completed or partially failed.
10. The mobile app displays status and authorized Open Folder/Open PDF/Open Spreadsheet actions.

## Recommended development order

### Milestone 1 — real authentication and cloud bootstrap

- Provision Supabase and apply migrations.
- Generate types.
- Implement sign-in/session/sign-out and route guards.
- Bootstrap organization and superadmin membership.
- Add RLS integration tests.

### Milestone 2 — reliable synchronization

- Define local-to-remote event and participant mapping.
- Implement event outbox replay first.
- Implement attendance insert/update/delete replay.
- Add network triggers, manual retry, backoff, conflict states, and tests.
- Remove or relabel simulated Sync controls until they invoke the real worker.

### Milestone 3 — FastAPI and export jobs

- Scaffold `backend/` with FastAPI, typed configuration, health checks, tests, and linting.
- Add Supabase JWT verification and scoped authorization.
- Add the export job/artifact migration and idempotent request/status endpoints.
- Add a worker execution model appropriate for the deployment platform.

### Milestone 4 — Google Drive and renderers

- Enable Drive API and configure server-side authorization.
- Verify write access to the supplied root folder using a non-PII test file.
- Implement idempotent folder resolution with Shared Drive support when applicable.
- Generate PDF statistics and XLSX participant data.
- Upload artifacts, persist metadata, and implement bounded retry/partial-failure recovery.
- Add the Create Report UI only after job status can be observed end to end.

### Milestone 5 — remaining product gaps and release hardening

- Persist manual attendance.
- Add participant roster import/matching and managed QR issuance/revocation.
- Validate Android and iOS device behavior.
- Add CI, migration checks, Python checks, secret scanning, monitoring, retention rules, backup/restore, and release profiles.

## Recommended first Claude task

Start with Milestone 1, not Google Drive. A suitable first task is:

> Connect the existing Expo client to a development Supabase project, generate database types, replace mock login with Supabase email authentication, add session-aware route guards, and document the manual bootstrap procedure for the first organization and superadmin. Preserve the local-first repository behavior and do not implement synchronization in the same change.

This is intentionally bounded. Authentication and organization context are prerequisites for secure synchronization and report authorization.

## Development commands

```powershell
cd "D:\Research\React Native"
npm install
Copy-Item .env.example .env
npm run start:lan
```

Validation baseline:

```powershell
npm run check
npm run test
npx expo-doctor
```

Use an Expo web export smoke test after routing, dependency, or bundling changes:

```powershell
npx expo export --platform web --output-dir .expo-web-check
```

## Latest validation

Validation completed on 2026-08-26 after testing live Supabase data, FastAPI CSV exports, Google Drive folder integration, and automatic CSV export update upon sync queue completion:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: TypeScript and Expo lint (0 errors, 0 warnings) |
| `npm run test` | Passed: 7 test suites, 37 tests |
| Live Supabase Test | Passed: Connected to real Supabase database, queried 6 events, 30 participants, 30 attendance records |
| Google Drive Upload | Passed: Created event subfolders and uploaded CSV export reports for live events |
| Sync Auto-Export | Passed: `processSyncQueue` automatically triggers Google Drive CSV export update for synced events |

Physical Android and iOS scan verification remains manual and was not performed in this automated pass.

## Handoff checklist for the next agent

- Read `AGENTS.md`, this report, architecture, and implementation plan.
- Run `git status --short` before editing.
- Confirm whether real Supabase/Google credentials are available through secure environment configuration; never request that secrets be committed or pasted into source files.
- Keep changes focused on one milestone.
- Add migrations rather than editing applied SQL.
- Add tests for new domain or infrastructure behavior.
- Run the full validation baseline.
- Update this report and the implementation-plan checkboxes when the repository's real status changes.
