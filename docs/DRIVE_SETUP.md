# Google Drive authorization — decision record

**Date:** 2026-08-17
**Status:** Decided — Option A (server-side OAuth). Setup runbook below.
The service-account path was tested and rejected on evidence, not theory.
**Supersedes:** the "Recommended Drive design" bullet list in `docs/PROGRESS_REPORT.md`, which
left the service-account-vs-OAuth question open. This document closes it.

## What we actually have

| Item | Value | Assessment |
| --- | --- | --- |
| Credential file | `vibe-336fa-0741444daece.json` | Service account, valid JSON, private key present |
| Identity | `firebase-adminsdk-kcl1w@vibe-336fa.iam.gserviceaccount.com` | **Wrong tool for the job** — see below |
| Google Cloud project | `vibe-336fa` | A Firebase project; Drive API enablement unverified |
| Target folder | `1jBU2Jg_XbnvW2M4mPL7Rv3S5UEeoKFu8` | Confirmed to live in a **personal Google Drive**, not a Shared Drive |

Two problems, one of them fatal.

### Problem 1 — this is a Firebase Admin SDK key (fixable, but fix it)

`firebase-adminsdk-*` service accounts are auto-created by Firebase and granted broad
project-level roles so the Admin SDK can manage auth, Firestore, and storage. Using that
identity as a Drive uploader violates least privilege: a compromised backend would hold far
more than "can write report files."

It has also been sitting untracked-but-not-ignored in a Git repository with a live GitHub
remote. Treat it as potentially exposed.

**Action:** delete this key in IAM and do not reuse it for Drive. See "Immediate cleanup".

### Problem 2 — a service account cannot write to a personal Drive (fatal)

This is not a permissions problem and no amount of re-sharing fixes it. Google's own Drive
API error documentation states it plainly:

> Service accounts don't have storage quota and can't own any files. Instead, they must
> upload files and folders into shared drives, or use OAuth 2.0 to upload items on behalf
> of a human user.

When a service account uploads a file, the service account becomes the file's owner. Owning a
file consumes the owner's storage quota. A service account has no quota, so the upload is
rejected with `403 storageQuotaExceeded`. In a Shared Drive the *drive* owns the file and the
org's pooled quota is charged, which is why that path works.

The trap worth knowing about: `files.get` on the folder will succeed and
`capabilities.canAddChildren` will report `true`. The folder looks writable right up until the
first upload fails. `capabilities` reflects sharing permission only — it knows nothing about
quota. Verify with a real upload, never with a permissions check.

## Things that look like they should fix Problem 2, but don't

### "We shared the folder with public access"

This was tried on 2026-08-17. It does not work, and it creates a separate and more serious
problem.

**Why it doesn't work.** Drive applies two independent gates to an upload:

1. *Authorization* — may this caller add a child to this folder? Link sharing answers this.
2. *Quota* — whose storage does the new file consume? Ownership answers this, and the
   uploader becomes the owner.

Public link sharing opens gate 1 and has no effect on gate 2. The service account still ends up
as the owner of the uploaded file, still has no quota to charge it against, and the upload
still fails with `403 storageQuotaExceeded`. Sharing settings cannot grant storage to an
identity that has none. Run `scripts/verify_drive_access.py` to watch this happen: the folder
check will pass and report `canAddChildren=true`, and the write probe will still fail.

**Why it is worse than the problem it tried to solve.** This folder is the intended destination
for attendance reports, which contain participant names, full 10-digit student IDs, and
programs. "Anyone with the link" makes the link itself the only credential, and links leak
through chat, email, screenshots, and commit history.

Note specifically that `docs/PROGRESS_REPORT.md` records the full folder URL, and that file is
committed and pushed to the GitHub remote. **If that repository is public, the folder link is
already public.** With link access set to Editor, anyone who finds the repository can read,
overwrite, and delete attendance reports.

This also directly contradicts `AGENTS.md` line 111: "Never make attendance reports public by
default. Drive file IDs and folder links are integration references, not proof of access."

**Action:** set the folder back to Restricted now. Confirm whether
`github.com/yhnalx/icpep-scansync` is public; if it is, treat the folder ID as disclosed and
create the eventual report root as a fresh folder that has never had a public ACL.

### "We'll grant the service account Editor on the folder"

Same reasoning. Editor is gate 1. Quota is gate 2. `capabilities.canAddChildren` will report
`true` and the upload will still fail.

### "We'll give the service account a Google Cloud storage role / more IAM permissions"

Drive quota is not an IAM concept. No project-level role grants a service account Drive
storage, because service accounts categorically cannot own Drive files.

## Options

### Option A — server-side OAuth as a designated human account (recommended)

The backend holds a refresh token for one Google account that owns the report files. Files are
charged against that account's 15 GB.

- Works with a consumer/personal Google account — no Workspace subscription needed
- Use scope `https://www.googleapis.com/auth/drive.file`, which Google classifies as
  **non-sensitive** and recommends for most use cases. It only grants access to files and
  folders the app itself created, which is exactly the least-privilege shape we want:
  the backend can never read the rest of the user's Drive
- **Consequence to accept:** `drive.file` cannot see the pre-existing folder
  `1jBU2Jg_...`, because that folder was not created by the app. The backend must create
  its own root folder on first run and we record that new ID as
  `GOOGLE_DRIVE_ROOT_FOLDER_ID`. The supplied folder ID gets retired
- **Operational gotcha:** while the OAuth app's audience is set to *Testing*, refresh tokens
  issued to test users expire after 7 days, which would break exports every week. Publish the
  app to *In production* to get long-lived refresh tokens. Because `drive.file` is
  non-sensitive, this needs only basic app verification rather than the security assessment
  that the restricted full-`drive` scope triggers
- Cost: a one-time interactive consent to mint the refresh token, then store
  client ID, client secret, and refresh token in the hosting secret store

### Option B — Google Workspace Shared Drive with a service account

Architecturally the cleanest, and what `AGENTS.md` line 110 already expresses a preference for.

- No refresh-token lifecycle at all — service-account keys don't expire on a 7-day clock
- Files owned by the Shared Drive, so they survive any individual leaving
- Add a **dedicated** service account (no project roles) as Content Manager on the drive
- All Drive calls need `supportsAllDrives=true`
- **Cost:** requires a paid Google Workspace tenant. If this project has, or can get, a
  Workspace domain, take this option instead of A

### Option C — full `drive` scope OAuth to keep the existing folder

Only worth it if retiring folder `1jBU2Jg_...` is genuinely unacceptable.

- `https://www.googleapis.com/auth/drive` is a **restricted** scope: it grants read/write over
  the account's entire Drive, and publishing requires verification plus potentially a
  third-party security assessment because the backend stores data server-side
- Grossly disproportionate access for "write two report files per event"
- **Not recommended**

## Decision (2026-08-17)

**Option A — server-side OAuth, `drive.file` scope, owner = the maintainer's personal
Google account.** No Google Workspace domain is available, so Option B is off the table.

Confirmed by running `scripts/verify_drive_access.py --mode service_account` against the
supplied credential: it reached the write probe and failed with `403 storageQuotaExceeded`,
exactly as predicted. `GOOGLE_SERVICE_ACCOUNT_JSON` stays empty and the Firebase key is retired.

### Accepted tradeoff, and how to unwind it later

Owning report files in a personal account means student PII (names, full 10-digit student IDs,
programs) lives in an individual's Drive, and handing the project to next year's officers means
handing over credentials. That is a real cost and it was accepted knowingly.

The design keeps it reversible: the owning identity is nothing but three values in the secret
store, and the backend addresses folders by ID rather than by account. Migrating later —
to a dedicated `icpep.scansync.reports@gmail.com`, or to a Workspace Shared Drive if the
university ever provides one — means minting a new token, moving the folder tree, and updating
`GOOGLE_DRIVE_ROOT_FOLDER_ID`. No application code changes. Keep it that way: never let an
account address, a person's name, or a folder *name* become load-bearing in backend logic.

## Setup runbook

Roughly 20 minutes. Steps 1–4 are one-time console work; step 5 is the token; step 6 proves it.

### 1. Pick or create the Google Cloud project

Do **not** reuse the Firebase project `vibe-336fa`. Create a project dedicated to this backend
so its API surface and credentials stay scoped to attendance reporting:
<https://console.cloud.google.com/projectcreate>. Name it something like
`icpep-scansync-reports`.

### 2. Enable the Drive API

<https://console.cloud.google.com/apis/library/drive.googleapis.com> → select the new project →
**Enable**. Allow a minute to propagate; calls made immediately after enabling can still 403.

### 3. Configure the OAuth consent screen

APIs & Services → **OAuth consent screen**.

- User type: **External**
- App name: something recognizable on the consent screen, e.g. `ICpEP ScanSync Reports`
- User support email and developer contact email: your address
- Scopes: add **`.../auth/drive.file`** only. Do not add `.../auth/drive` — it is a
  *restricted* scope that triggers verification and possibly a third-party security assessment,
  and this backend does not need it

### 4. Publish the app to production — do not skip this

On the OAuth consent screen (or Audience) page, click **Publish app** so the audience is
**In production** rather than **Testing**.

This is the single step most likely to bite you later. While the audience is *Testing*,
Google expires refresh tokens issued to test users after **7 days**, so exports would break
roughly weekly with `invalid_grant` and nobody would understand why. Publishing removes that
expiry. Because `drive.file` is classified **non-sensitive**, publishing needs only basic app
verification — no security assessment.

You will still see an "unverified app" interstitial when consenting. That is expected for a
self-published internal tool; click through the **Advanced** link.

### 5. Create the OAuth client and mint the refresh token

APIs & Services → Credentials → **Create credentials** → **OAuth client ID** →
Application type: **Desktop app**.

Desktop app matters: Google auto-allows `http://127.0.0.1:<any port>` as a redirect for that
client type, which is what the minting script's loopback flow needs. A *Web application*
client would reject it with `redirect_uri_mismatch`.

Copy the client ID and secret, then:

```powershell
cd "D:\Research\React Native"
$env:GOOGLE_OAUTH_CLIENT_ID     = "xxxx.apps.googleusercontent.com"
$env:GOOGLE_OAUTH_CLIENT_SECRET = "xxxx"
py .\scripts\mint_drive_refresh_token.py
```

A browser opens; **sign in as the account that should own the report files**. The script runs
the authorization-code flow with PKCE, validates the `state` parameter, exchanges the code, and
prints the refresh token. It never writes the token to disk.

If it prints "No refresh_token in the response", the account has consented to this client
before. Revoke at <https://myaccount.google.com/permissions> and re-run — Google only issues a
refresh token on first consent.

### 5b. The one-command path (recommended)

Put the client ID and secret into `backend/.env` first, then let the minter write the token
there itself:

```powershell
py .\scripts\mint_drive_refresh_token.py --manual --write-env
```

This is the recommended route because it removes both causes of `invalid_grant` on a
freshly minted token:

- The token is written straight to the file, never printed, so it cannot be truncated by a
  wrapped terminal line or a partial clipboard copy.
- The client ID and secret are read from the same file the backend reads, and written back
  alongside the token, so the token cannot be bound to a different client than the one the
  backend presents.

`--write-env` rewrites only the four keys it owns, preserves comments, ordering, unrelated keys
and CRLF line endings, and swaps the file atomically. It refuses to run if `backend/.env` does
not already exist.

### 6. Store the secrets and verify

Put these in `backend/.env` for local work (gitignored) and in the hosting provider's secret
store for deployment:

```text
GOOGLE_DRIVE_AUTH_MODE=oauth_user
GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=xxxx
GOOGLE_OAUTH_REFRESH_TOKEN=1//xxxx
```

Then create the report root and prove the whole chain works:

```powershell
py .\scripts\verify_drive_access.py --mode oauth --create-root "Attendance Manager Reports"
```

Expect all checks to pass, ending in `0 failed`. Record the folder ID it prints as
`GOOGLE_DRIVE_ROOT_FOLDER_ID`. Re-runs use `--folder-id <that id>` instead of `--create-root`.

### Why the root folder must be created by the script

The `drive.file` scope only reaches files and folders **the application itself created**. It
cannot see `1jBU2Jg_XbnvW2M4mPL7Rv3S5UEeoKFu8`, because a human made that folder in the Drive
UI. Passing it as `--folder-id` returns 404 by design.

So the original folder ID is retired. The app-created root is permanently reachable by the
backend and by nothing else, which is a stronger security posture than the folder we started
with — the backend cannot read the owner's other files even if it is compromised.

Update the "Google Drive report handoff" section of `docs/PROGRESS_REPORT.md` once the new ID
exists, and note there that the old ID was retired and briefly had a public ACL.

## Immediate cleanup

1. Delete the exposed key in IAM: Google Cloud console → project `vibe-336fa` → IAM & Admin →
   Service Accounts → `firebase-adminsdk-kcl1w@...` → Keys → delete key `074144...`.
   Do this even if you later choose Option B with a different account.
2. Move `vibe-336fa-0741444daece.json` out of the repository folder entirely. `.gitignore`
   now blocks it, but a credential inside a working tree is still one bad `git add -f` or
   one screenshot away from disclosure.
3. Confirm it never reached the remote:
   ```powershell
   git log --all --diff-filter=A --name-only -- "*.json" | Select-String "vibe-"
   ```
   Empty output means clean. Non-empty means the key is in history and must be
   rotated and the history rewritten.
4. Check whether anything in the Firebase project depended on that key before deleting it.

## Tooling

### `scripts/verify_drive_access.py`

Probes a credential end to end and reports per check whether the backend can actually write:
token minting, Drive API enablement, storage headroom, folder reachability, My Drive vs Shared
Drive, and — decisively — a real test upload followed by cleanup.

```powershell
# OAuth mode (default). Credentials come from the environment or backend/.env,
# deliberately never from argv, so the refresh token stays out of shell history.
py .\scripts\verify_drive_access.py --mode oauth --folder-id "<root id>"
py .\scripts\verify_drive_access.py --mode oauth --create-root "Attendance Manager Reports"

# Service-account mode (needs: py -m pip install --upgrade cryptography)
py .\scripts\verify_drive_access.py --mode service_account --key-file ".\key.json" --folder-id "<id>"
```

Flags: `--no-write` for read-only checks, `--keep` to leave the probe file, `--env-file` to
point at a different `.env`.

Exit codes: `0` writable · `1` write blocked · `2` local config problem · `3` token minting
failed · `4` Drive API not enabled · `5` folder unusable.

The probe uploads one file containing the literal text "Attendance Manager Drive write probe",
never participant data, and deletes it afterward unless `--keep` is passed.

The verdict that matters is the write probe. `capabilities.canAddChildren` is reported for
information only — it reflects sharing permission and is blind to quota, which is precisely
the trap that cost us the service-account path.

### `scripts/mint_drive_refresh_token.py`

One-time interactive OAuth setup. Authorization-code flow with PKCE over a loopback redirect,
`state` validated before the code is exchanged, `prompt=consent` and `access_type=offline` so a
refresh token is actually issued. Prints the token to the terminal only — never to disk.

### Troubleshooting the consent flow

Google's OAuth error pages end with `Request details: flowName=GeneralOAuthFlow`. That line is
boilerplate on every one of them and carries no diagnostic information. Read the **error code
and headline above it**.

Which endpoint failed narrows the cause sharply, because the two steps validate different
things. The browser (authorization) step sends only the **client ID**. The client **secret** is
not transmitted until the token exchange, after the browser has already accepted the ID.

| What you see | Where | Cause and fix |
| --- | --- | --- |
| `Error 401: invalid_client` in the **browser** | authorization | The client ID is unrecognized. The secret is irrelevant here. Run `--dry-run` and compare the ID character for character; check you are looking at the right Cloud project. |
| `invalid_client` at the **token step** | token exchange | The client ID was accepted, so the **secret** is wrong. Re-copy it, or add a new secret — Google hides existing secret values after creation. |
| `Error 400: redirect_uri_mismatch` | authorization | The OAuth client is type *Web application*. See below — either create a Desktop app client, or pin the port with `--port` and register it. |
| `Error 403: access_denied` | authorization | Audience is still *Testing* and this account is not a test user (see step 4), or you dismissed the consent screen. |
| `Google hasn't verified this app` | authorization | Not an error. Expected for a self-published app. Click **Advanced**, then **Go to … (unsafe)**. |
| `invalid_grant` when refreshing later | token exchange | Almost always the 7-day *Testing* expiry. Publish to production and re-mint. |

#### Fixing `redirect_uri_mismatch`

The client type decides whether the callback address needs registering. Check the **Type**
column on the credentials page.

**Desktop app** clients accept `http://127.0.0.1:<any port>` with nothing registered, which is
why the runbook specifies that type. If yours is a *Web application*, either:

*Option 1 (preferred) — create a Desktop app client.* Credentials → Create credentials → OAuth
client ID → Application type **Desktop app**. Use its ID and secret and re-run. Nothing to
register, and the ephemeral port keeps working forever. Delete the Web application client if it
has no other use.

*Option 2 — register a fixed loopback URI on the existing client.* Pin the port so the URI is
stable, then register it verbatim:

```powershell
py .\scripts\mint_drive_refresh_token.py --port 8765
```

Add exactly `http://127.0.0.1:8765/callback` under **Authorized redirect URIs** on the client,
save, and wait a moment for it to propagate.

Two traps in Option 2:

- **`127.0.0.1` and `localhost` are different registered values to Google.** Registering one
  does not authorize the other. The script defaults to `127.0.0.1`; use
  `--redirect-host localhost` if you registered that instead.
- **The path must match too.** The script uses `/callback`, so registering
  `http://127.0.0.1:8765` alone will still mismatch.

`--dry-run` prints the exact redirect URI the run would use, so you can copy it straight into
the console rather than guessing.

#### `127.0.0.1 refused to connect`, or the flow never prints a token

The browser reached the callback address and nothing was listening. The authorization URL is
bound to a single process run — the local server, the `state` value and the PKCE verifier are
all generated per run — so a URL from any other run is dead. Causes:

- you authorized with a URL printed by `--dry-run`, which starts no server
- you authorized with a URL from an earlier run whose process had exited
- the run timed out (default 300s) before consent completed
- a firewall or security tool blocked the local listener

**The reliable fix is `--manual`, which never starts a server:**

```powershell
py .\scripts\mint_drive_refresh_token.py --manual
```

It prints the authorization URL, you approve in the browser, the browser shows
"This site can't be reached" — **which is expected** — and you paste the whole address bar back
into the script. The authorization code is in that URL; the error page is just the browser
failing to render a response from a server that was never there.

Manual mode uses a fixed redirect URI of `http://127.0.0.1:8765/callback` so the value it sends
at the token step matches what you pasted. It accepts a full URL, a bare query string, or a raw
code, validates `state` when present, and refuses to exchange a code whose state belongs to an
earlier run.

#### `--dry-run`

Validates the client ID's format, echoes it delimited by `>>>` and `<<<` so trailing whitespace
is visible, prints the redirect URI and the full authorization URL, and contacts nothing:

```powershell
py .\scripts\mint_drive_refresh_token.py --dry-run
```

The script also strips surrounding whitespace and quotes from both values before use, and
rejects an ID that does not end in `.apps.googleusercontent.com`, is duplicated, or contains an
internal space or a smart quote. A trailing space from a copy-paste into `$env:` produces
`invalid_client`, which reads as a credentials problem rather than the formatting problem it is.

### `scripts/test_verify_drive_access.py`

Offline self-test for the probe. Stands up a fake Drive API and OAuth token endpoint on
localhost and drives every branch, asserting on the requests sent as well as the verdicts
printed. No credentials, no network, no pytest:

```powershell
py .\scripts\test_verify_drive_access.py
```

Run it after touching the probe. It has already caught one real defect — the full `drive`
scope string is a prefix of `drive.file`, so substring scope matching flagged correctly
least-privileged tokens as over-privileged.

## Where Drive sits in the plan

`docs/PROGRESS_REPORT.md` puts Drive in Milestone 4, behind Supabase auth (M1),
synchronization (M2), and FastAPI scaffolding (M3). That ordering is correct and this
finding does not change it. The reason is stated in the report itself: reports must be
generated from a synchronized, authorized Supabase snapshot, so a Drive uploader built now
would have nothing trustworthy to upload.

What this document changes is only that **the Drive authorization decision is now a
prerequisite to be settled during M1–M3, not a discovery to be made in M4.** Settle it early
because Option A and Option B imply different backend configuration, different secrets, and
different folder-resolver code.

## Secret placement (unchanged from AGENTS.md)

| Variable | Belongs in | Never in |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | root `.env` | — (public by design) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | root `.env` | — (public by design) |
| `EXPO_PUBLIC_API_URL` | root `.env` | — (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | hosting secret store | root `.env`, Git, logs |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | `backend/.env`, hosting secrets | root `.env` |
| `GOOGLE_DRIVE_AUTH_MODE` | `backend/.env`, hosting secrets | root `.env` |
| `GOOGLE_OAUTH_CLIENT_ID` | `backend/.env`, hosting secrets | root `.env` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | hosting secret store | any file in Git |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | hosting secret store | any file in Git |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | hosting secret store | any file in Git |

Expo inlines every `EXPO_PUBLIC_*` variable into the client bundle. Anything in the root
`.env` is readable by anyone who downloads the app, so a backend secret placed there is
disclosed to every user.
