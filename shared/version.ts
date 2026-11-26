import type { VersionInfo } from './types.js'

export const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/MateusGabi/OpenGrokBot/refs/heads/main/package.json'
export const REPO_URL = 'https://github.com/MateusGabi/OpenGrokBot'
export const DOWNLOAD_URL = `${REPO_URL}/releases`

export type UpdateStatus = 'checking' | 'upToDate' | 'updateAvailable' | 'unknown'

export function updateStatus(info: VersionInfo | null, failed: boolean): UpdateStatus {
  if (failed) return 'unknown'
  if (!info) return 'checking'
  if (info.upToDate === true) return 'upToDate'
  if (info.upToDate === false) return 'updateAvailable'
  return 'unknown'
}
