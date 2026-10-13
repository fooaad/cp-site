// Loads a file that ships next to this code (`new URL('./x', import.meta.url)`), in the browser
// or in Node (scripts/spike.ts), where fetch() can't read files.
export async function fetchBytes(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  if (url.protocol === 'file:') {
    // The module name is a variable so the browser build doesn't try to bundle it.
    const fsModule = 'node:fs/promises'
    const fs: { readFile(url: URL): Promise<Uint8Array<ArrayBuffer>> } = await import(/* @vite-ignore */ fsModule)
    return fs.readFile(url)
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
