# Automatic Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar versão, tag e instalador automaticamente a cada merge de PR na `main`.

**Architecture:** Uma lógica pura e testável em `scripts/release-bump.mjs` decide o próximo número a partir dos commits desde a última tag. Um workflow `release.yml` (push em `main`, `contents: write`) usa essa saída para sincronizar os manifests, commitar/tagar e, num job Windows separado, gerar e anexar o instalador ao GitHub Release.

**Tech Stack:** Node 22, `node:test`, GitHub Actions, npm `version`, electron-builder (via `npm run build:desktop`), `gh release create`.

**Spec:** `docs/superpowers/specs/2026-11-26-automatic-release-design.md`

## Global Constraints

- Bump por commits desde a última tag: `BREAKING CHANGE:` / `!:` → major, `feat:` → minor, `fix:` → patch; `docs:` / `chore:` / `refactor:` sozinhos → sem release.
- A última tag é a fonte da verdade da versão, não o `package.json`.
- Nenhuma dependência npm nova.
- `package.json` e `package-lock.json` sempre sincronizados com a tag `vX.Y.Z`.
- Commits de release começam com `chore(release):` e são ignorados pelo cálculo de bump.
- O instalador NSIS é gerado em `windows-latest`; artefatos ficam em `release/`.
- `ci.yml` permanece inalterado.

## Review Focus

- Merge cujo subject é `Merge pull request #…` com apenas `chore:`/`docs:` → não deve gerar release. Teste: `returns null when no releasable commit`.
- `feat!:` ou corpo com `BREAKING CHANGE:` junto de um `feat:` → major deve vencer. Teste: `breaking change wins over feat and fix`.
- Vários commits elegíveis no mesmo intervalo → o maior bump vence. Teste: `highest bump wins`.
- O próprio commit `chore(release): vX.Y.Z` no intervalo → ignorado, sem loop. Teste: `ignores release commits`.
- Sem tag anterior → comportamento determinístico. Teste: `starts from 0.0.0 when there is no previous tag`.

---

### Task 1: Pure bump resolver

**Files:**
- Create: `scripts/release-bump.mjs`
- Create: `scripts/release-bump.test.mjs`

**Interfaces:**
- Consumes: array de subjects de commit e uma versão (`"0.5.0"`) ou `null`.
- Produces: `nextVersion(commits: string[], lastVersion: string | null): { version: string; bump: 'major' | 'minor' | 'patch' } | null`. A CLI do mesmo arquivo imprime `version=<v>` e `bump=<b>` quando executada diretamente, e nada quando não há release.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextVersion } from './release-bump.mjs'

test('returns null when no releasable commit', () => {
  assert.equal(nextVersion(['Merge pull request #5', 'docs: fix typo'], '0.5.0'), null)
})

test('patch bump from fix', () => {
  assert.deepEqual(nextVersion(['fix: search field contrast'], '0.5.0'), { version: '0.5.1', bump: 'patch' })
})

test('minor bump from feat', () => {
  assert.deepEqual(nextVersion(['feat: expressive avatars'], '0.5.0'), { version: '0.6.0', bump: 'minor' })
})

test('breaking change wins over feat and fix', () => {
  assert.deepEqual(nextVersion(['feat: avatars', 'feat!: change avatar api', 'fix: border'], '0.5.0'), { version: '1.0.0', bump: 'major' })
})

test('highest bump wins', () => {
  assert.deepEqual(nextVersion(['fix: a', 'feat: b', 'fix: c'], '1.2.3'), { version: '1.3.0', bump: 'minor' })
})

test('ignores release commits', () => {
  assert.equal(nextVersion(['chore(release): v0.5.0'], '0.5.0'), null)
})

test('starts from 0.0.0 when there is no previous tag', () => {
  assert.deepEqual(nextVersion(['fix: first'], null), { version: '0.0.1', bump: 'patch' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/release-bump.test.mjs`
Expected: FAIL (module not found / `nextVersion` undefined)

- [ ] **Step 3: Implement `nextVersion` in `scripts/release-bump.mjs`**

Regexes: breaking `/BREAKING CHANGE:|^\w+(?:\([^)]+\))?!:/`, feat `/^feat(?:\([^)]+\))?:/i`, fix `/^fix(?:\([^)]+\))?:/i`. Ignore subjects matching `/^chore\(release\):/`. Split `lastVersion` on `.` with `0` fallback; reset lower segments on major/minor. The CLI branch (guarded by `process.argv[1]`) reads `git tag --list --sort=-v:refname`, strips a leading `v`, reads `git log <tag>..HEAD --pretty=%s` (or all commits when no tag) and prints results only when non-null.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/release-bump.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/release-bump.mjs scripts/release-bump.test.mjs
git commit -m "feat: compute next release version from commits"
```

### Task 2: Run release tests in CI

**Files:**
- Modify: `package.json` (`scripts.test`)

**Interfaces:**
- Consumes: `scripts/release-bump.test.mjs` from Task 1.
- Produces: `npm test` also runs the release tests.

- [ ] **Step 1: Add the release test command to `scripts.test`**

Append `&& node --test "scripts/*.test.mjs"` to the existing test script, keeping the server compile and `dist/server` test run unchanged.

- [ ] **Step 2: Run the full test script**

Run: `npm test`
Expected: PASS, with the 7 release tests reported alongside the existing server tests

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: include release tests in npm test"
```

### Task 3: Release workflow and documentation

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `README.md` (Versioning section)

**Interfaces:**
- Consumes: CLI output `version=` / `bump=` from `scripts/release-bump.mjs`; `npm version <exact> --no-git-tag-version`; `npm run build:desktop` from `package.json`.
- Produces: GitHub Release `vX.Y.Z` with `release/*` artifacts.

- [ ] **Step 1: Write the workflow**

`name: Release`; `on: push.branches: [main]`; top-level `permissions.contents: write`.

Job `version` (`ubuntu-latest`): `actions/checkout@v4` with `fetch-depth: 0`; `actions/setup-node@v4` with `node-version: 22` and `cache: npm`; `npm ci --ignore-scripts`; step id `bump` running `node scripts/release-bump.mjs >> "$GITHUB_OUTPUT"`. All later steps in this job guarded by `if: steps.bump.outputs.version != ''`. Skip `npm version` when `require('./package.json').version` already equals the target (the PR may have bumped it, as PR #5 did to 0.6.0); otherwise run `npm version ${{ steps.bump.outputs.version }} --no-git-tag-version`. Commit with `git add package.json package-lock.json && git commit -m "chore(release): v${{ steps.bump.outputs.version }}"`; `git tag -a v${{ steps.bump.outputs.version }} -m "Release v${{ steps.bump.outputs.version }}"`; push commit and tag with `git push origin HEAD:main --follow-tags`.

Job `installer` (`windows-latest`, `needs: version`, same `if` guard on `needs.version.outputs.version`): checkout the `v${{ needs.version.outputs.version }}` tag; setup-node 22 with npm cache; `npm ci --ignore-scripts`; `npm run build`; `npm run build:desktop`; `gh release create v${{ needs.version.outputs.version }} release/* --title "v${{ needs.version.outputs.version }}" --generate-notes` with `GH_TOKEN: ${{ github.token }}`.

Expose `version` as a job output on `version` so `installer` can use it.

- [ ] **Step 2: Validate the workflow file**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))"` (if PyYAML is unavailable, state `Not verified` and manually inspect the YAML).
Expected: parses without error; `on`, `permissions`, `jobs.version`, `jobs.installer` present.

- [ ] **Step 3: Update README Versioning**

Replace the manual-only instructions with: releases are cut automatically on merges to `main`; bump rules from commit subjects; tag/release artifacts; keep `npm run gabber -- --next=<mode>` as the way to preview the next number.

- [ ] **Step 4: Run the complete verification**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml README.md
git commit -m "feat: release version and installer on every main merge"
```
