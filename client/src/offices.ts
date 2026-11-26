/** Bridge exposed by Electron to the chat window. Absent in a plain browser. */
export interface OfficeInfo {
  id: string
  name: string
  dir: string
  port: number
}

export interface OfficesState {
  offices: OfficeInfo[]
  activeId: string | null
}

export interface OfficesApi {
  list(): Promise<OfficesState>
  create(name: string): Promise<OfficeInfo>
  add(dir: string, name: string): Promise<OfficeInfo>
  open(id: string): Promise<boolean>
  rename(id: string, name: string): Promise<boolean>
  remove(id: string, deleteData?: boolean): Promise<boolean>
  close(): Promise<boolean>
  onOpen(callback: () => void): () => void
}

declare global {
  interface Window {
    offices?: OfficesApi
  }
}

export function officesApi(): OfficesApi | null {
  return typeof window !== 'undefined' && window.offices ? window.offices : null
}
