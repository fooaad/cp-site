// Autosave in the browser. Storage can be unavailable (private mode, blocked site data),
// so every access is allowed to fail.
const PREFIX = 'cp-site:'

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function save(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    // Not saved; the page keeps working.
  }
}
