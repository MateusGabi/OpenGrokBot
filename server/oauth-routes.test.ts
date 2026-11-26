import test from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { createOAuthRoutes, type OAuthRoutesApi } from './oauth-routes.js'
import { GOOGLE_DRIVE_SCOPES } from './oauth.js'
import type { OAuthStatus } from './oauth-store.js'

const REDIRECT = 'http://127.0.0.1:4310/api/mcp/oauth/google-drive/callback'

function makeFake() {
  const calls: { start: { name: string; input: Parameters<OAuthRoutesApi['start']>[1] }[]; complete: { name: string; state: string; code: string }[]; disconnect: string[] } = { start: [], complete: [], disconnect: [] }
  let status: OAuthStatus = 'connected'
  const api: OAuthRoutesApi = {
    start(name, input) {
      calls.start.push({ name, input })
      return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=st', state: 'st' }
    },
    async complete(name, state, code) {
      calls.complete.push({ name, state, code })
      if (state !== 'ok') throw new Error('bad state')
    },
    status: () => status,
    disconnect(name) {
      calls.disconnect.push(name)
    },
  }
  return { api, calls, setStatus: (s: OAuthStatus) => { status = s } }
}

async function withServer(api: OAuthRoutesApi, hasServer: (name: string) => boolean, fn: (base: string) => Promise<void>): Promise<void> {
  const app = express()
  app.use(express.json())
  app.use('/api/mcp/oauth', createOAuthRoutes(api, hasServer))
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

test('status: sem def é absent, com def devolve o status sem vazar o secret', async () => {
  const { api } = makeFake()
  await withServer(api, () => false, async (base) => {
    const res = await fetch(`${base}/api/mcp/oauth/google-drive/status`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'absent' })
  })
  await withServer(api, () => true, async (base) => {
    const res = await fetch(`${base}/api/mcp/oauth/google-drive/status`)
    const text = await res.text()
    assert.deepEqual(JSON.parse(text), { status: 'connected' })
    assert.equal(text.includes('client-secret'), false)
  })
})

test('start usa o redirect_uri exato do browser e rejeita escopo desconhecido', async () => {
  const { api, calls } = makeFake()
  await withServer(api, () => true, async (base) => {
    const res = await fetch(`${base}/api/mcp/oauth/google-drive/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret', redirectUri: REDIRECT, scopes: [...GOOGLE_DRIVE_SCOPES] }),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=st', state: 'st' })
    assert.equal(calls.start[0]!.input.redirectUri, REDIRECT)
    const bad = await fetch(`${base}/api/mcp/oauth/google-drive/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret', redirectUri: REDIRECT, scopes: ['https://www.googleapis.com/auth/gmail.send'] }),
    })
    assert.equal(bad.status, 400)
  })
})

test('callback troca o código e responde HTML; state errado dá 400', async () => {
  const { api, calls } = makeFake()
  await withServer(api, () => true, async (base) => {
    const ok = await fetch(`${base}/api/mcp/oauth/google-drive/callback?state=ok&code=abc`)
    assert.equal(ok.status, 200)
    assert.match(await ok.text(), /Autorização concluída/)
    assert.deepEqual(calls.complete[0], { name: 'google-drive', state: 'ok', code: 'abc' })
    const bad = await fetch(`${base}/api/mcp/oauth/google-drive/callback?state=wrong&code=abc`)
    assert.equal(bad.status, 400)
  })
})

test('disconnect remove as credenciais locais', async () => {
  const { api, calls } = makeFake()
  await withServer(api, () => true, async (base) => {
    const res = await fetch(`${base}/api/mcp/oauth/google-drive/disconnect`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.deepEqual(calls.disconnect, ['google-drive'])
  })
})
