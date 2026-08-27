# Attendance Manager agent guide

This is the primary repository instruction file for Codex, Claude, and other coding agents. `CLAUDE.md` imports this guide. Read `docs/PROGRESS_REPORT.md` for the dated implementation snapshot, then verify the code because the repository remains the final source of truth.

## Mandatory first reads

1. Inspect `git status --short` and preserve unrelated user or agent changes.
2. Read `docs/PROGRESS_REPORT.md` for the latest handoff state.
3. Read `docs/ARCHITECTURE.md` before changing data flow, persistence, authentication, reporting, or service boundaries.
4. Read `docs/IMPLEMENTATION_PLAN.md` before starting a feature and update its checkboxes when work materially changes phase status.
5. Read the exact Expo SDK 54 documentation at https://docs.expo.dev/versions/v54.0.0/ before changing Expo or React Native behavior, configuration, or dependencies.

Older summaries such as `UPDATE.md` and `docs/ARCHITECTURE_OVERVIEW.md` are historical context. They may lag behind the current code and `docs/PROGRESS_REPORT.md`.

## Product goal

Build an offline-first event attendance system for superadmins, organizers, and time-limited volunteers. It records QR or manual attendance on mobile, synchronizes through Supabase, and requests PDF and spreadsheet reports from a FastAPI backend that automatically manages event folders in Google Drive.

## Current reality

As of the progress report dated 2026-08-17:

- The Expo UI and local SQLite/browser-storage vertical slice are functional.
- Event CRUD, event analytics, QR scanning, year-level classification, duplicate prevention, history search/filter/pagination, and guarded attendance edit/delete are present locally.
- Supabase client wiring and migrations exist, but the repository is not connected to a production Supabase project.
- Login is still mock authentication; it does not protect routes.
- The durable outbox exists, but there is no real connectivity-triggered Supabase sync worker. Existing Sync controls are placeholders.
- Manual entry is still a UI-only placeholder.
- `backend/` is a boundary stub; FastAPI, report rendering, and Google Drive uploads are not implemented.
- The supplied Drive root folder ID is recorded in `docs/PROGRESS_REPORT.md`, but a folder ID is not authorization.

Do not describe any placeholder above as production-ready or remotely synchronized.

## Platform priorities

- Android is the primary production platform. Validate permissions, navigation/back behavior, keyboard handling, camera lifecycle, performance, and smaller-screen layouts.
- iOS is the current physical-device test path over an Expo LAN server. Preserve the same feature path on iOS.
- Keep Expo on SDK 54 while the current physical iPhone depends on the App Store Expo Go compatibility window. Upgrade only after confirming the target Expo Go or an Apple-signed development build supports the new SDK.
- Web is an admin/development preview. Native uses SQLite; web uses browser storage and does not provide the same durability guarantees.
- Install Expo native packages with `npx expo install <package>`. Adding a native module not bundled with Expo Go requires a new development-client build.

## Hard architectural boundaries

- The Expo app is an untrusted public client. It may contain only publishable `EXPO_PUBLIC_*` configuration.
- Supabase is the intended system of record for identity, organizations, events, participants, attendance, invitations, and export-job status.
- SQLite is a device-local cache and outbox, not a second cloud database.
- FastAPI owns privileged Supabase access, report rendering, Google credentials, Drive folder management, and export uploads.
- Never put a Supabase `service_role` key, Google private key, OAuth refresh token, or service-account JSON in Expo, Git, fixtures, screenshots, or logs.
- Never call Google Drive directly from the mobile app using privileged credentials.
- Every remotely replayed mutation must be idempotent. Attendance uses `client_record_id`; export requests need their own idempotency key.
- Enable and test Row Level Security for every app-facing Supabase table. UI visibility is not authorization.
- Generate reports only from a synchronized, authorized Supabase snapshot. Do not generate an authoritative report from one device's local SQLite data.

## Repository map

- `src/app/`: thin Expo Router route composition.
- `src/components/`: reusable visual components.
- `src/features/auth/`: current mock login and future Supabase auth UI.
- `src/features/home/`: dashboard shell and quick statistics.
- `src/features/scan/`: camera scanning, manual-entry sheet, payload parsing, and feedback.
- `src/features/events/`: event list/detail UI, types, native SQLite repository, and web adapter.
- `src/features/attendance/`: history, filters, edit/delete controls, pagination, and year-level logic.
- `src/features/charts/`: event analytics visualizations.
- `src/lib/`: environment, Supabase client, SQLite initialization, preferences, UUIDs, and outbox primitives.
- `supabase/migrations/`: immutable forward-only PostgreSQL migrations.
- `backend/`: future independently deployable FastAPI application.
- `docs/`: architecture, plan, and handoff documentation.

## Route map

- `/`: dashboard.
- `/scan`: QR scanner and manual-entry entry point.
- `/profile`: device/preferences and mock-login link.
- `/events`: event list and creation.
- `/events/[id]`: event analytics, management, sync indicator, and event attendance.
- `/history`: event-scoped attendance history.
- `/login`: mock login only until Supabase Auth is implemented.

## Local data and QR rules

- Native persistence is defined in `src/lib/local-database.ts`; web behavior lives in `.web.ts` adapters.
- Mutate event/attendance data through `src/features/events/event-repository.ts` and its web adapter. Do not issue ad hoc persistence calls from screens.
- Use stable client-generated UUIDs for offline-created entities.
- Queue local writes first. Retries must remain safe after an app restart, timeout, duplicate response, or partial failure.
- Editing an unsynced record must rewrite the applicable queued insert/update payload.
- Deleting an unsynced insert removes the local row and queued insert. Deleting an already-remote record queues an idempotent delete.
- Keep destructive actions behind explicit confirmation.
- Managed QR format: `attendance://participant/<opaque-id>`.
- Legacy university QR format: `name<TAB>10-digit-student-id<TAB>program`.
- Treat legacy QR fields as untrusted, unsigned PII. Validate their shape, never log the raw payload, and allow authorized correction/deletion.
- Every event has an explicit `academicReferenceYear`. Valid ten-digit school IDs derive year level from their four-digit entry-year prefix and save immediately; opaque, malformed, or future-year references require operator confirmation until roster data can supply the classification. Preserve old null values as “year not recorded.”
- One participant reference may check in only once per event under the current product rule.

## Supabase workflow

- Apply migrations in timestamp order and never edit a migration already applied to a shared environment.
- Add a new timestamped migration for every schema or RLS change.
- Keep RLS policies and required indexes with the migration that introduces the behavior.
- After linking a real project, generate TypeScript database types and stop relying on hand-written remote row assumptions.
- The current remote schema requires organization/user context that local event records do not yet carry. Implement authentication/bootstrap and define the local-to-remote mapping before writing the sync worker.
- Test at minimum: superadmin, organizer, assigned volunteer, expired volunteer, unrelated user, duplicate replay, update replay, and delete replay.

## FastAPI and Google Drive rules

- Keep Python dependencies, configuration, tests, and deployment files inside `backend/`.
- FastAPI must validate the caller's Supabase JWT and event/organization role before accepting an export.
- A Create Report action must be unavailable or blocked while that event has unsynchronized mutations.
- Use one export job for a report bundle and model PDF/spreadsheet artifacts separately; the current one-kind/one-file schema needs a forward migration.
- Resolve or lazily create folders on the backend. Use Drive IDs and private `appProperties` such as `event_id`, `export_job_id`, and artifact kind instead of names as identity.
- Prefer a dedicated Google Workspace Shared Drive. If a service account is used, grant it access explicitly and store its credentials only in deployment secrets.
- Never make attendance reports public by default. Drive file IDs and folder links are integration references, not proof of access.
- Retry Drive operations with bounded exponential backoff. Reuse an existing folder/file for the same job instead of duplicating it.
- Do not log participant names, student IDs, QR payloads, report rows, tokens, or raw provider errors.

## Code conventions

- Keep TypeScript strict and avoid `any`. Validate unknown data at network, QR, and storage boundaries.
- Prefer named domain types and explicit infrastructure return types.
- Keep route files thin; business rules belong in features and cross-feature infrastructure belongs in `src/lib`.
- Use parameterized SQLite/PostgreSQL statements. Never interpolate user values into SQL.
- Use UTC ISO-8601 timestamps at storage/network boundaries and localize only for display.
- Preserve platform-specific adapters (`.web.ts`, native default) when adding repository behavior.
- Keep accessibility labels, disabled states, keyboard behavior, safe areas, and touch target sizes intact.
- Do not add real participant data to examples or tests. Use clearly fictional values.

## Environment and secrets

Copy `.env.example` to `.env`. Only these mobile values are currently allowed:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_API_URL`

Backend-only settings, including `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, service-account material, and OAuth refresh tokens, belong in the backend/hosting secret store. Provide a committed backend `.env.example` with placeholders when backend scaffolding begins, but never a real secret.

## Commands

```powershell
npm install
Copy-Item .env.example .env
npm run start:lan
npm run typecheck
npm run lint
npm run test
npm run check
npx expo-doctor
```

Additional commands:

```powershell
npm run start            # Expo Go
npm run start:dev-client # custom development client
npm run android
npm run web
```

On Windows, physical iOS validation uses Expo Go over LAN or EAS; a local iOS simulator/build requires macOS.

## Verification and handoff

- Before handing work off, run `npm run check`, `npm run test`, and `npx expo-doctor`. Run an Expo web export smoke test after routing or bundling changes.
- Add focused tests for parsers, repositories, outbox retries, authorization, migrations, report generation, and Drive idempotency.
- Update `docs/IMPLEMENTATION_PLAN.md` when phase checkboxes change.
- Update `docs/PROGRESS_REPORT.md` after a material feature, architecture decision, migration, setup change, or newly discovered blocker.
- Include commands run, migrations added, platform gaps, manual cloud setup, and unresolved risks in every handoff.
- Do not commit or push unless the user explicitly asks. Do not rewrite unrelated history or discard another contributor's work.
