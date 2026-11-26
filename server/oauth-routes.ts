import { Router } from 'express'
import { GOOGLE_DRIVE_SCOPES } from './oauth.js'
import type { OAuthStatus } from './oauth-store.js'

export interface OAuthRoutesApi {
  start(name: string, input: { clientId: string; clientSecret: string; redirectUri: string; scopes: readonly string[] }): { authorizationUrl: string; state: string }
  complete(name: string, state: string, code: string): Promise<void>
  status(name: string): OAuthStatus
  disconnect(name: string): void
}

/** OAuth callback must be reachable without the app's OPENGROKBOT_TOKEN; it is bound to state + PKCE instead. */
export function createOAuthRoutes(api: OAuthRoutesApi, hasServer: (name: string) => boolean): Router {
  const router = Router()

  router.get('/:name/status', (req, res) => {
    const name = String(req.params.name)
    res.json({ status: hasServer(name) ? api.status(name) : 'absent' })
  })

  router.post('/:name/start', (req, res) => {
    const name = String(req.params.name)
    if (!/^[A-Za-z0-9_-]+$/.test(name) || !hasServer(name)) {
      res.status(400).json({ error: 'Unknown MCP server.' })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const { clientId, clientSecret, redirectUri, scopes } = body
    if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret.trim() || typeof redirectUri !== 'string' || !redirectUri.trim() || !Array.isArray(scopes)) {
      res.status(400).json({ error: 'clientId, clientSecret, redirectUri and scopes are required.' })
      return
    }
    const expected = [...GOOGLE_DRIVE_SCOPES].sort()
    const actual = [...scopes].sort()
    if (actual.length !== expected.length || actual.some((scope, i) => scope !== expected[i])) {
      res.status(400).json({ error: 'Only Drive read and file scopes are supported.' })
      return
    }
    try {
      res.json(api.start(name, { clientId, clientSecret, redirectUri, scopes: actual }))
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.get('/:name/callback', async (req, res) => {
    const name = String(req.params.name)
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    if (!/^[A-Za-z0-9_-]+$/.test(name) || !state || !code) {
      res.status(400).type('html').send('<!doctype html><meta charset="utf-8"><title>Google Drive</title><p>Link de autorização inválido.</p>')
      return
    }
    try {
      await api.complete(name, state, code)
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Google Drive</title><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div><h2>Autorização concluída — você pode fechar esta janela.</h2></div><script>window.opener?.postMessage({ type: 'ogb-oauth', name: ${JSON.stringify(name)} }, window.location.origin)</script></body>`)
    } catch {
      res.status(400).type('html').send('<!doctype html><meta charset="utf-8"><title>Google Drive</title><p>Não foi possível concluir a autorização. Volte ao Marketplace e tente novamente.</p>')
    }
  })

  router.post('/:name/disconnect', (req, res) => {
    api.disconnect(String(req.params.name))
    res.json({ ok: true })
  })

  return router
}
