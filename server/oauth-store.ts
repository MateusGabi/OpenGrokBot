import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export type OAuthStatus = 'absent' | 'configured' | 'connected'

export interface OAuthEntry {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  state?: string
  codeVerifier?: string
}

/** Client credentials and tokens live here, never in team.json (which is sent to the browser). */
export class OAuthStore {
  private entries: Record<string, OAuthEntry>

  constructor(private readonly file: string) {
    this.entries = this.load()
  }

  private load(): Record<string, OAuthEntry> {
    if (!existsSync(this.file)) return {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, OAuthEntry>
    } catch {
      // A corrupt store starts empty; the user can reconnect.
    }
    return {}
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(this.entries, null, 2)}\n`)
    renameSync(tmp, this.file)
  }

  get(name: string): OAuthEntry | undefined {
    return this.entries[name]
  }

  set(name: string, entry: OAuthEntry): void {
    this.entries[name] = entry
    this.persist()
  }

  delete(name: string): void {
    delete this.entries[name]
    this.persist()
  }

  status(name: string): OAuthStatus {
    const entry = this.entries[name]
    if (!entry) return 'absent'
    if (entry.accessToken && (entry.expiresAt === undefined || entry.expiresAt > Date.now())) return 'connected'
    return 'configured'
  }
}
