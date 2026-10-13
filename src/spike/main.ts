const out = document.getElementById('out')!
const start = performance.now()
const print = (line: string) => {
  out.textContent += `[${((performance.now() - start) / 1000).toFixed(1)} s] ${line}\n`
}

print(`${navigator.userAgent}`)
print('Starting worker; the first compile downloads the toolchain…')
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
worker.onmessage = (e: MessageEvent<{ line?: string; done?: boolean }>) => {
  if (e.data.line) print(e.data.line)
  if (e.data.done) {
    print('Done.')
    document.title = 'spike: done'
  }
}
worker.onerror = (e) => print(`Worker error: ${e.message}`)
worker.postMessage('start')
