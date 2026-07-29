/** Keep in sync with repo-root `ports.json` (bundled UI cannot import that file). */
export const DESKTOP_API_ORIGIN = 'http://127.0.0.1:18773';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

export function resolveApiUrl(path: string): string {
  if (!isTauriRuntime()) return path;
  return new URL(path, DESKTOP_API_ORIGIN).toString();
}
