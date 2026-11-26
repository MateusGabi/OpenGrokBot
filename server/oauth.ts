import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { OAuthStore, type OAuthEntry, type OAuthStatus } from './oauth-store.js'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_DRIVE_MCP_URL = 'https://drivemcp.googleapis.com/mcp/v1self'
export const GOOGLE_DRIVE_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
]

/** Authorization is interactive and happens in the Marketplace UI, never inside an employee turn. */
export class OAuthNeedsAuthError extends Error {}

export interface OAuthAccess {
  accessToken(name: string): Promise<string | undefined>
  authProvider(name: string): OAuthClientProvider | undefined
  status(name: string): OAuthStatus
}

export interface OAuthStartInput {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: readonly string[]
}

export class GoogleOAuth implements OAuthAccess {
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly inflight = new Map<string, Promise<string>>()
  private readonly generations = new Map<string, number>()

  constructor(private readonly store: OAuthStore, opts: { fetch?: typeof fetch; now?: () => number } = {}) {
    this.fetchFn = opts.fetch ?? fetch
    this.now = opts.now ?? Date.now
  }

  private generation(name: string): number {
    return this.generations.get(name) ?? 0
  }

  private bump(name: string): void {
    this.generations.set(name, this.generation(name) + 1)
  }

  start(name: string, input: OAuthStartInput): { authorizationUrl: string; state: string } {
    const expected = [...GOOGLE_DRIVE_SCOPES].sort()
    const actual = [...input.scopes].sort()
    if (actual.length !== expected.length || actual.some((scope, i) => scope !== expected[i])) {
      throw new OAuthNeedsAuthError('Only Drive read and file scopes are supported.')
    }
    const state = randomUUID()
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    this.bump(name)
    this.store.set(name, {
      ...(this.store.get(name) ?? {}),
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      redirectUri: input.redirectUri,
      scopes: [...input.scopes],
      state,
      codeVerifier,
    })
    const url = new URL(GOOGLE_AUTH_URL)
    url.searchParams.set('client_id', input.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', input.scopes.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return { authorizationUrl: url.toString(), state }
  }

  async complete(name: string, state: string, code: string): Promise<void> {
    const entry = this.store.get(name)
    if (!entry || !entry.state || entry.state !== state) throw new OAuthNeedsAuthError('OAuth state does not match; start the authorization again.')
    const params = new URLSearchParams({
      client_id: entry.clientId,
      client_secret: entry.clientSecret,
      redirect_uri: entry.redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: entry.codeVerifier ?? '',
    })
    const tokens = await this.tokenRequest(name, params, entry, this.generation(name))
    this.saveTokens(name, tokens, entry)
    delete entry.state
    delete entry.codeVerifier
    this.store.set(name, entry)
  }

  status(name: string): OAuthStatus {
    return this.store.status(name)
  }

  disconnect(name: string): void {
    this.bump(name)
    this.store.delete(name)
  }

  async accessToken(name: string): Promise<string | undefined> {
    const entry = this.store.get(name)
    if (!entry) return undefined
    if (entry.accessToken && (entry.expiresAt === undefined || entry.expiresAt > this.now() + 60_000)) return entry.accessToken
    // Expired without a refresh token means the user must reconnect; never install a stale Bearer header.
    if (!entry.refreshToken) return undefined
    const pending = this.inflight.get(name)
    if (pending) return pending
    const refresh = this.refresh(name).finally(() => this.inflight.delete(name))
    this.inflight.set(name, refresh)
    return refresh
  }

  authProvider(name: string): OAuthClientProvider | undefined {
    const entry = this.store.get(name)
    if (!entry) return undefined
    return {
      redirectUrl: entry.redirectUri,
      clientMetadata: {
        redirect_uris: [entry.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      state: () => this.store.get(name)?.state ?? randomUUID(),
      clientInformation: () => ({ client_id: entry.clientId, client_secret: entry.clientSecret }),
      tokens: async () => {
        const token = await this.accessToken(name)
        const current = this.store.get(name)
        if (!token || !current) return undefined
        return {
          access_token: token,
          token_type: 'Bearer',
          expires_in: Math.max(0, Math.floor(((current.expiresAt ?? this.now()) - this.now()) / 1000)),
          refresh_token: current.refreshToken,
        }
      },
      saveTokens: (tokens) => this.saveTokens(name, tokens),
      redirectToAuthorization: () => {
        throw new OAuthNeedsAuthError('Google Drive needs reauthorization. Open Settings → Marketplace and reconnect.')
      },
      saveCodeVerifier: (codeVerifier) => {
        const current = this.store.get(name)
        if (!current) return
        current.codeVerifier = codeVerifier
        this.store.set(name, current)
      },
      codeVerifier: () => this.store.get(name)?.codeVerifier ?? '',
    }
  }

  private async refresh(name: string): Promise<string> {
    const entry = this.store.get(name)
    if (!entry) throw new OAuthNeedsAuthError('Google Drive credentials were removed.')
    const params = new URLSearchParams({
      client_id: entry.clientId,
      client_secret: entry.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: entry.refreshToken ?? '',
    })
    const tokens = await this.tokenRequest(name, params, entry, this.generation(name))
    this.saveTokens(name, tokens, entry)
    return entry.accessToken!
  }

  private async tokenRequest(name: string, params: URLSearchParams, entry: OAuthEntry, generation: number): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    const res = await this.fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (this.store.get(name) !== entry || this.generation(name) !== generation) {
      throw new OAuthNeedsAuthError('Google authorization changed while the request was in flight.')
    }
    const body: unknown = await res.json().catch(() => ({}))
    if (this.store.get(name) !== entry || this.generation(name) !== generation) {
      throw new OAuthNeedsAuthError('Google authorization changed while the request was in flight.')
    }
    if (!res.ok) {
      const err = typeof body === 'object' && body !== null ? String((body as { error?: string }).error ?? '') : ''
      if (err === 'invalid_grant') {
        delete entry.accessToken
        delete entry.refreshToken
        delete entry.expiresAt
        this.store.set(name, entry)
      }
      throw new OAuthNeedsAuthError(err || `Google token request failed (${res.status}).`)
    }
    const parsed = body as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!parsed.access_token) throw new OAuthNeedsAuthError('Google token response had no access token.')
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expires_in: parsed.expires_in }
  }

  private saveTokens(name: string, tokens: { access_token: string; refresh_token?: string; expires_in?: number }, expected?: OAuthEntry): void {
    const entry = this.store.get(name)
    if (!entry || (expected && entry !== expected)) throw new OAuthNeedsAuthError('Google credentials changed; reconnect in the Marketplace.')
    entry.accessToken = tokens.access_token
    if (tokens.refresh_token) entry.refreshToken = tokens.refresh_token
    entry.expiresAt = this.now() + (tokens.expires_in ?? 3600) * 1000
    this.store.set(name, entry)
  }
}
