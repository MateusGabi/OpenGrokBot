import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextVersion } from './release-bump.mjs'

const CLI = fileURLToPath(new URL('./release-bump.mjs', import.meta.url))

function gitIn(dir, ...args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function repoWith(commits, tagAfter = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'release-bump-'))
  gitIn(dir, 'init', '-q')
  gitIn(dir, 'config', 'user.email', 'test@example.com')
  gitIn(dir, 'config', 'user.name', 'Test')
  commits.forEach((message, i) => {
    writeFileSync(join(dir, 'file.txt'), String(i))
    gitIn(dir, 'add', 'file.txt')
    gitIn(dir, 'commit', '-q', '-m', message)
    if (tagAfter === i + 1) gitIn(dir, 'tag', 'v0.5.0')
  })
  return dir
}

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

test('CLI detects BREAKING CHANGE in a commit body', () => {
  const dir = repoWith(['feat: first', 'feat: change\n\nBREAKING CHANGE: drop api'], 1)
  try {
    const out = execFileSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8' })
    assert.match(out, /version=1\.0\.0/)
    assert.match(out, /bump=major/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI computes from all commits when there is no tag', () => {
  const dir = repoWith(['fix: first'])
  try {
    const out = execFileSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8' })
    assert.match(out, /version=0\.0\.1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
