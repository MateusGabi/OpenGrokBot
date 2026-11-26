# Automatic release on merge to main

Date: 2026-11-26

## Intent

Every PR merged into `main` should produce a new SemVer version, tag, and published
installer without manual steps. Today `.github/workflows/ci.yml` only checks the code;
tags come from Gabber by hand and `npm run build:desktop` runs locally.

## Goals

- Bump from Conventional Commits since the last tag: `BREAKING CHANGE:` / `!:` → major,
  `feat:` → minor, `fix:` → patch; `docs:` / `chore:` / `refactor:` alone → no release.
- Keep `package.json` and `package-lock.json` in sync with the `vX.Y.Z` tag.
- Publish a GitHub Release with the NSIS `.exe`, `latest.yml` and the block map.
- No new npm dependencies; reuse the vendored Gabber SemVer convention.

## Non-goals

- Publishing to npm or any package registry.
- Changing the existing `ci.yml` checks job.
- Supporting a `master` branch (this repo uses `main`).

## Anti-goals

- Cutting a release for docs/chore-only merges.
- An infinite loop where the version commit triggers another release.
- Two workflows publishing the same version.

## Constraints

- The workflow needs `contents: write`; `main` branch protection may need to allow the
  `GITHUB_TOKEN` push or be relaxed for this bot.
- `actions/checkout` must use `fetch-depth: 0` to see tags and full history.
- electron-builder NSIS builds on `windows-latest`; `desktop/build.cjs` stages in temp
  and copies artifacts into `release/`.
- The last tag is the version source of truth, not `package.json` (they can drift).
- Release commits start with `chore(release):` — this is the loop guard.

## Approaches

1. **Own workflow + Gabber convention (chosen).** A `release.yml` parses commits and
   calls `npm version <exact>` to sync both manifests, then tags and publishes. No new
   dependencies and full control over installer assets; cost is custom parsing logic
   and a CI push to `main`.
2. **`semantic-release`.** Standard plugins handle commit analysis, manifests, changelog,
   tag and Release. Less custom code, but new devDependencies and an extra plugin to
   attach the electron-builder artifact.
3. **Release Please.** Opens a release PR with bump/changelog; publishing happens when
   that PR merges. Safest with branch protection, but adds an extra PR between the
   feature merge and the release.

## Decisions

- One new `.github/workflows/release.yml`, `on: push.branches: [main]`,
  `permissions.contents: write`.
- Job `tag` (ubuntu): checkout full history; if HEAD is already `chore(release):`, stop.
  Compute bump from `git log <last-tag>..HEAD`; if none, stop. Compute the exact next
  version from the last tag (Gabber semantics), run
  `npm version <VERSION> --no-git-tag-version`, commit `chore(release): vX.Y.Z`, create
  the annotated tag, push commit and tag.
- Job `installer` (windows, `needs: tag`): checkout the tag, `npm ci --ignore-scripts`,
  `npm run build`, `npm run build:desktop`, then attach everything in `release/` to the
  GitHub Release whose body is the commit list since the previous tag.
- Version bump commits are skipped by the guard, so no release loop.

## Left to builder

- Use `gh release create` (preinstalled on runners) or `softprops/action-gh-release`.
- Decide whether a first-ever release without tags should start at `v0.1.0`.
