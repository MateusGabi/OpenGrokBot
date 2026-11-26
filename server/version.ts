import type { VersionInfo } from '../shared/types.js'
import { DOWNLOAD_URL, REPO_URL, VERSION_CHECK_URL } from '../shared/version.js'

export type FetchJson = (url: string) => Promise<unknown>

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`version check failed: ${res.status}`)
  return res.json()
}

function numbers(version: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0)]
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = numbers(a)
  const right = numbers(b)
  for (let i = 0; i < 3; i++) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export class VersionChecker {
  private cached: { latest: string; at: number } | null = null

  constructor(
    private readonly current: string,
    private readonly fetchJson: FetchJson = defaultFetchJson,
    private readonly now: () => number = Date.now,
    private readonly cacheMs = 10 * 60 * 1000,
  ) {}

  async info(): Promise<VersionInfo> {
    const checkedAt = this.now()
    const stale = this.cached?.latest ?? null
    let latest = stale
    const fresh = this.cached !== null && checkedAt - this.cached.at < this.cacheMs
    if (!fresh) {
      try {
        const data = await this.fetchJson(VERSION_CHECK_URL)
        const version = (data as { version?: unknown } | null)?.version
        if (typeof version === 'string' && version.trim()) {
          latest = version.trim()
          this.cached = { latest, at: this.now() }
        }
      } catch {
        // Offline: keep the last known version, if any.
      }
    }
    return {
      current: this.current,
      latest,
      upToDate: latest === null ? null : compareVersions(this.current, latest) >= 0,
      checkedAt,
      repoUrl: REPO_URL,
      downloadUrl: DOWNLOAD_URL,
    }
  }
}
