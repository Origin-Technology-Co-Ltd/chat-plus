# Publishing ChatPlus to the public mirror

This guide is for maintainers of the **private** development repository. The public mirror is [Origin-Technology-Co-Ltd/chat-plus](https://github.com/Origin-Technology-Co-Ltd/chat-plus).

## Two different Actions (do not mix them up)

| Action | What it does | What it does **not** do |
|--------|----------------|-------------------------|
| **Sync to public repo** | Copies allowlisted **source** (incl. `src-tauri`, `scripts`, public workflows), `docs/`, changelogs to public `main` | Build installers or attach `.dmg` / `.exe` / `.AppImage` by itself |
| **Publish desktop release** | Builds **macOS / Windows / Linux** installers and creates a **Release** on `chat-plus` with those files + changelog notes | Replace Sync (still Sync first so public tree / Pages stay current) |

After Sync, you can run **Publish desktop release** on either:

- the **private** repo (uses `PUBLIC_REPO_TOKEN` to write public Releases), or  
- the **public** `chat-plus` repo (uses `GITHUB_TOKEN` on that repo).

If you only Sync (or create a Release by hand without Publish), GitHub may show only **Source code (zip/tar)** — that is **not** the desktop installers.

## What gets synced

On `main` push (or manual `workflow_dispatch`), `.github/workflows/sync-public.yml` copies an allowlist into a clean staging tree and **force-pushes** it to the public `main` branch (snapshot history — private commit history is not mirrored).

**Included:**

- `frontend/`, `backend/`, `src-tauri/` (no `target/`, no built `binaries/chatplus-backend-*`)
- `scripts/`
- root `package.json`, `ports.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`
- `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `CHANGELOG.zh-CN.md`, `docs/`, `LICENSE` if present
- `.github/workflows/publish-desktop-release.yml`, `.github/workflows/desktop-build.yml`

**Excluded:** `.trellis/`, `.cursor/`, `AGENTS.md`, `sync-public.yml`, any `data/` directory, `.env*`, `node_modules/`, `dist/`, `src-tauri/target/`, sidecar binaries, SQLite `*.db*` runtime files.

Never commit tokens or `.env` files.

## 1. Create credentials (private → public sync / cross-repo publish)

Use either option:

### Option A — Fine-grained Personal Access Token (recommended)

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Resource owner: `Origin-Technology-Co-Ltd` (or your account if the repo is personal).
3. Repository access: only `chat-plus`.
4. Permissions: **Contents → Read and write** (and Metadata read). Needed to force-push the sync snapshot and (from the private repo) to create/update public Releases.
5. Generate and copy the token once.

### Option B — Classic PAT

Create a classic token with the `repo` scope that can write to `Origin-Technology-Co-Ltd/chat-plus`.

## 2. Add the secret on the private repo

1. Private repo → Settings → Secrets and variables → Actions.
2. New repository secret:
   - Name: `PUBLIC_REPO_TOKEN`
   - Value: the PAT

Do not put the token in source, docs examples, or commit messages.

When you run **Publish desktop release** on the **public** repo, no extra secret is required (`GITHUB_TOKEN` is enough) if Actions permissions allow creating Releases (Settings → Actions → General → Workflow permissions → Read and write).

## 3. Run the sync once

1. Actions → **Sync to public repo** → Run workflow (or push to `main`).
2. Confirm the public repo contains `src-tauri/`, `scripts/`, `.github/workflows/publish-desktop-release.yml`, changelogs, and **does not** contain `.trellis/`, `.cursor/`, `AGENTS.md`, or `sync-public.yml`.

## 4. Enable GitHub Pages on the public repo

After the first successful sync:

1. Open [chat-plus](https://github.com/Origin-Technology-Co-Ltd/chat-plus) → Settings → Pages.
2. Source: **Deploy from a branch**.
3. Branch: `main`, folder: **`/docs`** (not `/` — root would expose app source as the site).
4. Save. Site URL is typically:

   `https://origin-technology-co-ltd.github.io/chat-plus/`

   English: `/` · Chinese: `/zh/` · Changelog: `/changelog.html` · `/zh/changelog.html`

## 5. Desktop release (installers + changelog downloads)

1. Update **both** `CHANGELOG.md` and `CHANGELOG.zh-CN.md` with `## [X.Y.Z] - YYYY-MM-DD`.
2. Ensure `src-tauri/tauri.conf.json` `version` is `X.Y.Z`.
3. Push private `main` and wait for **Sync to public repo** (or run it manually).
4. On **private or public** repo: Actions → **Publish desktop release** → version `X.Y.Z`.
5. Open `https://github.com/Origin-Technology-Co-Ltd/chat-plus/releases` — you should see installers (`.dmg` / `.exe` / `.AppImage`) plus changelog notes, not only Source code archives.

Optional: **Desktop build (artifacts only)** builds installers as temporary Actions artifacts for debugging — it does **not** create a public Release.

### Stable asset names

| Platform | Asset |
|----------|--------|
| macOS Apple Silicon | `ChatPlus-macos-aarch64.dmg` |
| Windows x64 | `ChatPlus-windows-x64-setup.exe` (plus `ChatPlus-windows-x64.msi` when built) |
| Linux x64 | `ChatPlus-linux-x64.AppImage` (plus `ChatPlus-linux-x64.deb` when built) |

Latest: `https://github.com/Origin-Technology-Co-Ltd/chat-plus/releases/latest`

If `## [X.Y.Z]` is missing from `CHANGELOG.md`, or tag `vX.Y.Z` already exists on the repo running the workflow, publish fails on purpose — fix changelog / delete the old tag, then re-run.

## Rollback

- Disable or delete `sync-public.yml` in the private repo.
- Force-push an empty or previous snapshot to public `main` if needed.
- Disable `publish-desktop-release.yml` or delete a mistaken public Release manually.
- Revoke the PAT if it may have leaked.
