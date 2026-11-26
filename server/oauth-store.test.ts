import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OAuthStore, type OAuthEntry } from './oauth-store.js'

function tempFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'ogb-oauth-'))
  return { file: path.join(dir, 'mcp-oauth.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const entry: OAuthEntry = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://127.0.0.1:4310/api/mcp/oauth/google-drive/callback',
  scopes: ['drive.readonly', 'drive.file'],
}

test('salva e relê entradas entre instâncias', () => {
  const { file, cleanup } = tempFile()
  try {
    new OAuthStore(file).set('google-drive', entry)
    assert.deepEqual(new OAuthStore(file).get('google-drive'), entry)
  } finally {
    cleanup()
  }
})

test('status acompanha o ciclo de vida', () => {
  const { file, cleanup } = tempFile()
  try {
    const store = new OAuthStore(file)
    assert.equal(store.status('google-drive'), 'absent')
    store.set('google-drive', entry)
    assert.equal(store.status('google-drive'), 'configured')
    store.set('google-drive', { ...entry, accessToken: 'tok', expiresAt: Date.now() + 60_000 })
    assert.equal(store.status('google-drive'), 'connected')
    store.set('google-drive', { ...entry, accessToken: 'tok', expiresAt: Date.now() - 1 })
    assert.equal(store.status('google-drive'), 'configured')
    store.delete('google-drive')
    assert.equal(store.status('google-drive'), 'absent')
  } finally {
    cleanup()
  }
})
