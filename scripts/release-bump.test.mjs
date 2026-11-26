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
