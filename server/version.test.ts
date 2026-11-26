import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VersionChecker, compareVersions } from './version.js'

test('compareVersions orders semver-like strings', () => {
  assert.equal(compareVersions('0.5.0', '0.5.1'), -1)
  assert.equal(compareVersions('0.6.0', '0.5.9'), 1)
  assert.equal(compareVersions('0.5.0', '0.5.0'), 0)
  assert.equal(compareVersions('0.6.0-beta.1', '0.5.9'), 1)
})

test('info reports an available update with the configured URLs', async () => {
  const checker = new VersionChecker('0.5.0', async () => ({ version: '0.6.0' }))
  const info = await checker.info()
  assert.equal(info.current, '0.5.0')
  assert.equal(info.latest, '0.6.0')
  assert.equal(info.upToDate, false)
  assert.equal(info.repoUrl, 'https://github.com/MateusGabi/OpenGrokBot')
  assert.equal(info.downloadUrl, 'https://github.com/MateusGabi/OpenGrokBot/releases')
  assert.equal(typeof info.checkedAt, 'number')
})

test('info reports up to date for equal and newer local versions', async () => {
  const equal = await new VersionChecker('0.5.0', async () => ({ version: '0.5.0' })).info()
  assert.equal(equal.upToDate, true)
  const newerLocal = await new VersionChecker('0.5.0', async () => ({ version: '0.4.9' })).info()
  assert.equal(newerLocal.upToDate, true)
})

test('info survives network failure and malformed remote json', async () => {
  const offline = await new VersionChecker('0.5.0', async () => { throw new Error('offline') }).info()
  assert.equal(offline.latest, null)
  assert.equal(offline.upToDate, null)
  const malformed = await new VersionChecker('0.5.0', async () => ({})).info()
  assert.equal(malformed.latest, null)
  assert.equal(malformed.upToDate, null)
})

test('info caches the remote version for ten minutes', async () => {
  let t = 1000
  let calls = 0
  const fetcher = async () => { calls++; return { version: '0.6.0' } }
  const checker = new VersionChecker('0.5.0', fetcher, () => t)
  await checker.info()
  await checker.info()
  assert.equal(calls, 1)
  t += 10 * 60 * 1000
  await checker.info()
  assert.equal(calls, 2)
})
