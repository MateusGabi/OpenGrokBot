import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'opengrokbot-theme'

/** Stored choice, or light for a fresh install. Kept in sync across tabs. */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Storage can be unavailable (private mode, file://); fall back to light.
  }
  return 'light'
}

function setMeta(name: string, content: string): void {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content)
}

/** The single switching mechanism: one attribute on <html>, all colors are tokens. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  setMeta('color-scheme', theme)
  setMeta('theme-color', theme === 'light' ? '#fafafa' : '#141414')
  setMeta('apple-mobile-web-app-status-bar-style', theme === 'light' ? 'default' : 'black-translucent')
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // The theme still applies for this session.
  }
  applyTheme(theme)
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setTheme(readTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [theme])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    saveTheme(next)
    setTheme(next)
  }, [theme])

  return { theme, toggle }
}
