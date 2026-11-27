/** Unanchored source for a bare http(s) URL token in chat text. */
export const LINK_SOURCE = String.raw`https?:\/\/[^\s<>"'\x60]+`

/** Return the linkable part of a token, or null when it is not a direct http(s) URL. */
export function linkFromToken(token: string): string | null {
  if (!/^https?:\/\//i.test(token)) return null
  let candidate = token.replace(/[.,;:!?\]}]+$/g, '')
  while (candidate.endsWith(')')) {
    const opens = (candidate.match(/\(/g) ?? []).length
    const closes = (candidate.match(/\)/g) ?? []).length
    if (closes <= opens) break
    candidate = candidate.slice(0, -1)
  }
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return candidate
  } catch {
    return null
  }
}
