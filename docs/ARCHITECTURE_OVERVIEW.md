# Project and codebase overview

This document describes the `icpep-scansync` (attendance-manager) project after the prototype
frontend from `rn-attendance-scanner` was migrated into it and refactored from Tailwind/NativeWind
utility classes to React Native `StyleSheet`.

## Product

An offline-first mobile attendance system for event organizers and time-limited volunteers:

- Scan managed `attendance://participant/<opaque-id>` QR codes or legacy university
  `name<TAB>student-id<TAB>program` QR codes.
- Record attendance locally in SQLite, automatically deriving year level for valid school IDs from the event academic reference year and requiring confirmation only when derivation is unavailable.
- Sync to Supabase when online using a durable, idempotent outbox (`client_record_id`).
- Request PDF/spreadsheet exports that a FastAPI backend writes into an event-specific Google
  Drive folder (Phase 5, not yet built).

## Repository layout

```
.
├── src/app/            Expo Router routes (route files are thin)
│   ├── _layout.tsx     Root stack: (auth) + (tabs)
│   ├── (tabs)/         Home, Scan, Profile tab routes + tab layout
│   └── (auth)/         Login route (reachable at /login, not the app gate)
├── src/components/     Reusable visual components only
├── src/constants/      theme.ts (light/dark), palette.ts (prototype UI palette)
├── src/features/       Feature modules (UI + domain logic + repositories)
├── src/hooks/          use-theme, use-color-scheme
├── src/lib/            Infrastructure: SQLite, sync queue, Supabase client, env, UUIDs
├── src/types/          Shared style declarations
├── supabase/migrations/  Forward-only PostgreSQL migrations
├── backend/            FastAPI service boundary (Phase 5 stub)
└── docs/               ARCHITECTURE.md, ARCHITECTURE_OVERVIEW.md, IMPLEMENTATION_PLAN.md
```

### `src/app` route map

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `src/app/(tabs)/index.tsx` | Home tab — dashboard, events, and history in one screen |
| `/scan` | `src/app/(tabs)/scan.tsx` | Scan tab — merged prototype camera UI + real scanner logic |
| `/profile` | `src/app/(tabs)/profile.tsx` | Profile tab — scanner/device/preferences UI |
| `/login` | `src/app/(auth)/login.tsx` | Ported prototype login (mock credentials, not the entry point) |

## Tech stack

- Expo SDK 54, React Native 0.81, React 19.1, TypeScript 5.9 (strict).
- `expo-router` v6 file-based routing with a root `Stack` and one `(tabs)` group.
- `expo-sqlite` for the local cache/outbox (native), browser storage on web.
- `expo-camera` QR scanning, `@expo/vector-icons` (Ionicons) for the migrated UI.
- `@supabase/supabase-js` public client (only when `EXPO_PUBLIC_*` keys are configured).
- `vitest` for unit tests; `eslint-config-expo` for linting.

## Navigation shell (3 tabs)

The prototype's floating bottom tab bar was ported to `src/components/app-tabs.tsx` with
`StyleSheet`: an absolute, rounded white bar with a raised center "Scan" button. The former
`app-tabs.web.tsx` (custom `expo-router/ui` tab list) was removed because the standard `Tabs`
component renders on web as well. The three tabs are Home, Scan, and Profile.

The root layout initializes the local database, wraps the app in `SafeAreaProvider` +
`ThemeProvider`, keeps the animated splash overlay, and defaults to the `(tabs)` group — the app
starts directly on the tabs (offline-first), matching the pre-migration behavior. The prototype's
mock login was preserved at `/login` (linked from the Profile tab) but does not gate the app.

## Feature modules

### `src/features/home` (integrated dashboard)

The Home tab replaces the former Dashboard, Events, and History tabs. All icpep-scansync features
that the prototype did not have were integrated here:

- `home-header.tsx` — prototype "Welcome back / Volunteer" header.
- `scanner-status-card.tsx` — prototype dark status card wired to real attendance counts and the
  first active event.
- `quick-stats.tsx` — prototype 3-card row showing real `totalAttendees`, `todayAttendees`, and
  `pendingSync`.
- `home-screen.tsx` — composition root; loads `getDashboardStats()`, `listEvents()`, and
  `listAttendanceHistory(50)` on focus and re-renders the sections.
- `events-section.tsx` — integrated events feature: list with selection, create-event modal
  (name, venue, date, time, expected attendees, active/draft status), and a per-event detail panel
  with `YearLevelBreakdown` and recent check-ins.
- `history-section.tsx` — integrated attendance history: filter chips by event, recent-scan rows,
  "View all", and guarded edit/delete modals backed by `updateAttendanceRecord` and
  `deleteAttendanceRecord`.

The `YearLevelBreakdown` component is reused from `src/features/attendance/year-level-breakdown.tsx`.

### `src/features/attendance` (scanning)

`scanner-screen.tsx` merges the prototype's full-bleed camera design with the real icpep scanner
logic:

- `scanner-overlay.tsx` — prototype viewfinder mask, corner reticles, animated scan line, and a
  torch toggle; accepts an optional `header` slot that hosts the active-event selector chips.
- `scanner-verification-pill.tsx` — floating feedback pill (Recorded / Scan Failed) driven by the
  scanner's feedback state.
- `scanner-manual-entry.tsx` — prototype "Manual Entry" bottom sheet (name + course). This is a UI
  stub; real roster-matched manual lookup is still a future Phase 4 item.
- Real logic preserved from icpep: camera permission flow (including the web-insecure LAN warning),
  `listActiveEvents()`, `parseAttendanceQrPayload()`, the mandatory year-level modal, and
  `recordQrAttendance()` with duplicate prevention and offline-safe outbox queuing. Scans are
  restricted
  to the center viewfinder box via the camera layout.

`qr-payload.ts`, `year-level.ts`, and `year-level-breakdown.tsx` are unchanged shared logic.

### `src/features/profile` and `src/features/auth`

- `profile-screen.tsx` — the prototype profile (account card, scanner account, device, preferences,
  actions) refactored to `StyleSheet`. "Sign Out" navigates to `/login`.
- `login-screen.tsx` — the prototype login refactored to `StyleSheet`. Mock credentials
  (`admin` / `password123`) remain as placeholders until Phase 2 Supabase Auth lands.

## Data flow

1. QR scan or manual input is validated locally (`qr-payload.ts`); legacy university QR fields are
   treated as identity claims, not authority.
2. The scanner derives 1st–4th year from a valid school ID and the event academic reference year; unresolved references use the confirmation fallback.
3. `event-repository.ts` writes the attendance record + outbox operation in one SQLite transaction
   (`local-database.ts`), keyed by a stable client-generated UUID.
4. UI confirms local capture without waiting for the network.
5. When online, a future sync worker replays `sync_queue` entries idempotently via
   `client_record_id` (Supabase/RLS is the system of record).
6. Attendance edits rewrite unsynced insert/update payloads; deleting an unsynced insert removes
   both record and queue item, while deleting a synced record queues an idempotent delete.

## Security boundaries

- The Expo app is a public client: only `EXPO_PUBLIC_*` values live in the bundle.
- Supabase `service_role`, Google credentials, and refresh tokens belong in the FastAPI/hosting
  secret store — never in mobile code or committed files.
- RLS must be enabled for every app-facing table; authorization is never solved only in UI code.
- QR payloads and participant PII are never logged.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run test`, and `npx expo-doctor` all pass.
- A web export smoke test bundles successfully and resolves `/`, `/scan`, `/profile`, and `/login`.

## Known gaps / notes

- The migrated Home/Profile/Login/tab-bar UI uses the prototype's static light palette
  (`src/constants/palette.ts`); the pre-existing theme-aware components (`ThemedText`,
  `ThemedView`, `ActionButton`, `YearLevelBreakdown`) still follow light/dark `useTheme`.
- The manual-entry sheet is a UI stub (no record is written) until Phase 4 real manual lookup.
- The mock login is a placeholder for Phase 2 Supabase Auth.
- `docs/ARCHITECTURE.md` remains the authority for system-level architecture; this document is the
  codebase-level overview.
