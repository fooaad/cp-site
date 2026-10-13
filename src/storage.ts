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

// `parse` checks the shape of what was stored and returns null if it doesn't fit.
export function loadJSON<T>(key: string, parse: (value: unknown) => T | null): T | null {
  const raw = load(key)
  if (raw === null) return null
  try {
    return parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveJSON(key: string, value: unknown) {
  save(key, JSON.stringify(value))
}
