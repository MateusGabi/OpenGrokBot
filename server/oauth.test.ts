import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { GoogleOAuth, OAuthNeedsAuthError, GOOGLE_DRIVE_SCOPES } from './oauth.js'
import { OAuthStore, type OAuthEntry } from './oauth-store.js'

const NAME = 'google-drive'
const REDIRECT = 'http://localhost:5180/api/mcp/oauth/google-drive/callback'

const baseEntry: OAuthEntry = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: REDIRECT,
  scopes: [...GOOGLE_DRIVE_SCOPES],
}

function setup(opts: { response?: () => Response | Promise<Response>; now?: () => number } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ogb-oauth-'))
  const store = new OAuthStore(path.join(dir, 'mcp-oauth.json'))
  const calls: { url: string; body: URLSearchParams }[] = []
  const fakeFetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init?.body ?? '')) })
    return opts.response?.() ?? Response.json({ access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' })
  }) as unknown as typeof fetch
  const oauth = new GoogleOAuth(store, { fetch: fakeFetch, ...(opts.now ? { now: opts.now } : {}) })
  return { store, oauth, calls, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('start gera URL de autorização com PKCE', () => {
  const { store, oauth, cleanup } = setup()
  try {
    const { authorizationUrl, state } = oauth.start(NAME, { ...baseEntry, scopes: GOOGLE_DRIVE_SCOPES })
    const url = new URL(authorizationUrl)
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    const entry = store.get(NAME)!
    assert.equal(url.searchParams.get('client_id'), 'client-id')
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.equal(url.searchParams.get('state'), state)
    assert.equal(state, entry.state)
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(entry.codeVerifier!).digest('base64url'))
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.deepEqual(url.searchParams.get('scope')?.split(' '), [...GOOGLE_DRIVE_SCOPES])
    assert.ok(entry.codeVerifier)
    assert.equal(entry.clientSecret, 'client-secret')
    assert.equal(entry.redirectUri, REDIRECT)
  } finally {
    cleanup()
  }
})

test('complete troca o código com code_verifier e persiste tokens', async () => {
  const { store, oauth, calls, cleanup } = setup()
  try {
    oauth.start(NAME, { ...baseEntry, scopes: GOOGLE_DRIVE_SCOPES })
    const verifier = store.get(NAME)!.codeVerifier!
    await oauth.complete(NAME, store.get(NAME)!.state!, 'abc')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token')
    assert.equal(calls[0]!.body.get('grant_type'), 'authorization_code')
    assert.equal(calls[0]!.body.get('code'), 'abc')
    assert.equal(calls[0]!.body.get('code_verifier'), verifier)
    assert.equal(calls[0]!.body.get('client_id'), 'client-id')
    assert.equal(calls[0]!.body.get('client_secret'), 'client-secret')
    assert.equal(calls[0]!.body.get('redirect_uri'), REDIRECT)
    const entry = store.get(NAME)!
    assert.equal(entry.accessToken, 'tok')
    assert.equal(entry.refreshToken, 'refresh')
    assert.equal(entry.state, undefined)
    assert.equal(entry.codeVerifier, undefined)
  } finally {
    cleanup()
  }
})

test('complete rejeita state divergente', async () => {
  const { store, oauth, calls, cleanup } = setup()
  try {
    oauth.start(NAME, { ...baseEntry, scopes: GOOGLE_DRIVE_SCOPES })
    await assert.rejects(() => oauth.complete(NAME, 'wrong', 'abc'), OAuthNeedsAuthError)
    assert.equal(store.get(NAME)!.accessToken, undefined)
    assert.equal(calls.length, 0)
  } finally {
    cleanup()
  }
})

test('accessToken renova quando expirado e reusa quando válido', async () => {
  const now = 1_000_000
  const { store, oauth, calls, cleanup } = setup({ now: () => now })
  try {
    store.set(NAME, { ...baseEntry, refreshToken: 'refresh', expiresAt: 999_000 })
    assert.equal(await oauth.accessToken(NAME), 'tok')
    assert.equal(calls[0]!.body.get('grant_type'), 'refresh_token')
    assert.equal(calls[0]!.body.get('refresh_token'), 'refresh')
    assert.equal(store.get(NAME)!.expiresAt, now + 3600_000)
    assert.equal(await oauth.accessToken(NAME), 'tok')
    assert.equal(calls.length, 1)
  } finally {
    cleanup()
  }
})

test('accessToken serializa renovações concorrentes', async () => {
  let resolveToken!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { resolveToken = resolve })
  let fetches = 0
  const { store, oauth, cleanup } = setup({
    response: () => {
      fetches++
      return pending
    },
  })
  try {
    store.set(NAME, { ...baseEntry, refreshToken: 'refresh', expiresAt: 1 })
    const first = oauth.accessToken(NAME)
    const second = oauth.accessToken(NAME)
    resolveToken(Response.json({ access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }))
    assert.deepEqual(await Promise.all([first, second]), ['tok', 'tok'])
    assert.equal(fetches, 1)
  } finally {
    cleanup()
  }
})

test('accessToken marca configured em invalid_grant', async () => {
  const { oauth, store, cleanup } = setup({
    response: () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
  })
  try {
    store.set(NAME, { ...baseEntry, refreshToken: 'refresh', expiresAt: 1 })
    await assert.rejects(() => oauth.accessToken(NAME), OAuthNeedsAuthError)
    assert.equal(oauth.status(NAME), 'configured')
    assert.equal(store.get(NAME)!.accessToken, undefined)
  } finally {
    cleanup()
  }
})

test('authProvider não abre navegador em turno de funcionário', async () => {
  const { oauth, store, cleanup } = setup()
  try {
    store.set(NAME, { ...baseEntry })
    await assert.rejects(async () => { await oauth.authProvider(NAME)!.redirectToAuthorization(new URL('https://accounts.google.com/')) }, OAuthNeedsAuthError)
  } finally {
    cleanup()
  }
})

test('authProvider.tokens devolve o token atual', async () => {
  const { oauth, store, cleanup } = setup()
  try {
    oauth.start(NAME, { ...baseEntry, scopes: GOOGLE_DRIVE_SCOPES })
    await oauth.complete(NAME, store.get(NAME)!.state!, 'abc')
    const tokens = await oauth.authProvider(NAME)!.tokens()
    assert.equal(tokens?.access_token, 'tok')
    assert.equal(tokens?.token_type, 'Bearer')
  } finally {
    cleanup()
  }
})
