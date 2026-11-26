/** Exposed by desktop/preload.cjs only when running inside Electron. */
interface DesktopWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizedChange(callback: (maximized: boolean) => void): () => void
}

declare global {
  interface Window {
    desktop?: DesktopWindowApi
  }
}

export {}
