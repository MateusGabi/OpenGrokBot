import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')

test('release workflow serializes runs', () => {
  assert.match(workflow, /concurrency:\s*\r?\n\s*group: release\s*\r?\n\s*cancel-in-progress: false/)
})

test('release workflow always syncs the lockfile', () => {
  assert.match(workflow, /npm version "\$VERSION" --no-git-tag-version --allow-same-version/)
})
