# Attendance Manager

Offline-first React Native attendance management for events, built with Expo and TypeScript. Supabase is the system of record; a later FastAPI service will generate PDF and spreadsheet reports and place them in event folders in Google Drive.

## Phase 1 status

The repository now contains:

- Expo SDK 54, React Native 0.81, React 19.1, TypeScript, and Expo Router
- Supabase client wiring with SQLite-backed session persistence
- a device-local SQLite sync outbox foundation
- a dashboard/history shell that runs without credentials
- a working superadmin dashboard with local event and attendance statistics
- local event creation and active-event selection
- QR camera permissions and duplicate-safe local attendance capture
- the initial Supabase schema and Row Level Security policies
- architecture, delivery plan, and agent collaboration guidance

No Supabase project or Google Cloud project is provisioned by this phase. The app deliberately reports an unconfigured cloud connection until local environment values are supplied.

## Local setup

Prerequisites: Node.js 20.19 or newer, npm, and either Expo Go or an Android emulator.

```bash
npm install
Copy-Item .env.example .env
npm run start
```

For LAN testing on a physical Android or iOS device:

```bash
npm run start:lan
```

The project temporarily targets Expo SDK 54 so it can open in the App Store version of Expo Go on a physical iPhone. Scan the native `exp://` QR code from Expo Go or the iPhone Camera app; do not open the web LAN address in Safari when testing the QR scanner.

Create an active event in the Events tab before opening Scan. The scanner accepts the managed format:

```text
attendance://participant/TEST-0001
```

It also accepts the university ID format, with literal tab characters between fields:

```text
NAME<TAB>10-DIGIT STUDENT ID<TAB>PROGRAM
```

University QR values contain personal information and are not signed. Valid payloads are stored as pending identity claims for later synchronization; they are not authoritative until a future participant-roster import matches the ID, name, and program. Authorized users can correct or delete inaccurate records from History.

Each event has an academic reference year. Valid university IDs automatically derive year level from their four-digit entry-year prefix and save immediately: an ID beginning with the reference year is 1st year, the previous cohort is 2nd year, and so on, capped at 4th year and above. Opaque, malformed, or future-year references still ask for confirmation rather than defaulting to an inaccurate first-year classification. The dashboard shows overall year-level totals, while Events and History provide per-event statistics and records.

History displays the complete student ID and provides Edit and Delete actions. Editing can correct the name, ID, program, and year level. Delete always requires confirmation and updates event statistics after removal.

Fill in `.env` after creating a Supabase project. Keep the publishable client key in the mobile app; keep the `service_role` key and all Google credentials server-side.

Validation:

```bash
npm run check
npm run test
npx expo-doctor
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Current progress and handoff report](docs/PROGRESS_REPORT.md)
- [Agent collaboration guide](AGENTS.md)
- [Backend boundary](backend/README.md)

## GitHub collaboration

The repository is connected to `https://github.com/yhnalx/icpep-scansync.git`. Review the working tree and create a focused branch before publishing feature work:

```bash
git status
git switch -c feature/short-description
git add <reviewed-files>
git commit -m "feat: describe the change"
git push -u origin feature/short-description
```

Do not commit `.env`, Google credentials, service-account JSON, access tokens, or participant data.
# ScanSync
