# FastAPI backend boundary

The backend is intentionally not implemented in Phase 1. It will be a separately deployable FastAPI service under this directory in Phase 5.

It will own:

- Supabase JWT verification and privileged service access
- export-job orchestration and retries
- PDF statistics and spreadsheet generation
- Google Drive OAuth/service-account secrets, folder management, and uploads

The Expo application must never contain these privileged credentials. See `docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_PLAN.md` before scaffolding this service.
