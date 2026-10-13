# cp-site plan

A browser-only competitive programming site: write C++, compile and run it in the
browser with Clang compiled to WebAssembly. Hosted free on GitHub Pages, no server.

Update this file as phases finish: tick boxes, record decisions, add what you learned.

## How it works

```
editor (C++) → clang.wasm in a Web Worker → program.wasm → WASI shim → Output
                (virtual filesystem with                      stdin ← Input box
                 libc++ headers, PCH)
```

## Phase 0: Prove the compiler works

Goal: a bare page compiles and runs a program that reads `cin`. No real UI.

- [x] Compare Clang-for-Wasm options → `@yowasp/clang` (see Decisions)
- [x] Compile A+B to `wasm32-wasi` in the browser
- [x] Run it with `@bjorn3/browser_wasi_shim`, stdin `3 4` → stdout `7`
- [x] Measure: download size, first compile time, repeat compile time
- [x] Record the choice and numbers under Decisions
- [ ] **Open: recursion depth.** Decide how to handle deep recursion before Phase 1 (see Findings)

Done when: A+B works in the browser and the numbers are written down. ✅ (2026-10-13)

How to re-run the checks: `node scripts/spike.ts`, or `npm run dev` and open `/spike.html`.

### Findings (Chrome 152, Web Worker, M-series Mac)

| Check | Result |
|---|---|
| Toolchain download | 105 MB raw; ~17 MB brotli / ~23 MB gzip for the compiler, ~3–4 MB for headers |
| First compile (toolchain cached by the browser) | ~0.9 s; with a cold download add network time |
| Later compiles, A+B with `<iostream>` | ~0.7–0.8 s |
| Compile with `<bits/stdc++.h>` | ~1.2–1.3 s (Phase 3 PCH should cut this) |
| 1e9 simple operations | 1.19 s in browser vs 0.95 s native clang -O2 (~1.25× slower) |
| Compile errors | clean Clang messages with line/column |
| Runtime error (`v.at(10)`) | caught as `unreachable` trap; needs a friendly "Runtime Error" message |
| **Max recursion depth (DFS)** | **1k–5k plain; 5k–10k with JSPI. CP needs 2e5–1e6.** |

- Recursion depth is limited by the browser engine's own native stack (~1 MB in Chrome), not by
  the wasm linear-memory stack, so `-Wl,-z,stack-size` doesn't help. Firefox/Safari not measured yet.
- Bundled libc++ has no exception support: compile with `-fno-exceptions`; `throw` won't compile,
  library errors abort (shown as runtime error).
- `<csetjmp>` and `<csignal>` don't build for wasm32-wasi; every other standard header does.
- Production build: Vite bundles the toolchain into `dist/assets` (largest file 75 MB, under
  GitHub's 100 MB limit). Not yet tested with `vite preview`.

## Phase 1: Minimum working site

- [ ] Editor: CodeMirror 6 with C++ highlighting
- [ ] Input box, Output box, Run button
- [ ] Compile and run in a Web Worker; 2 s limit shows "Time Limit Exceeded"
- [ ] Compile errors shown with line numbers

Done when: you can solve a Codeforces Div 2 A entirely on the site.

## Phase 2: CP comfort

- [ ] Default template + `bits/stdc++.h` stand-in
- [ ] Multiple test cases with expected output, pass/fail, diff
- [ ] Ctrl+Enter to run; `-O0` / `-O2` toggle
- [ ] Time and memory per run
- [ ] Autosave code and tests in the browser

## Phase 3: Speed

- [ ] Precompiled header for `bits/stdc++.h`
- [ ] Keep the compiler loaded in the worker between runs
- [ ] Cache compiler files after first visit (works offline)

Done when: a typical compile takes about 1 s after the first visit.

## Phase 4: Online

- [x] GitHub repo: github.com/fooaad/cp-site (private; must be public for free GitHub Pages)
- [ ] GitHub Actions workflow → GitHub Pages on every push; set Vite `base`
- [ ] Check file size limits for the compiler files; fall back to a CDN if needed

## Later

- "Run with GCC" via a compile API behind a Cloudflare Worker
- Multiple files/tabs, themes, snippet library
- Fetching Codeforces samples (needs a proxy because of CORS)

## Decisions

- Compile in the browser (not a compile API): free, unlimited, offline, no key to leak on a static site.
- Vite + React + TypeScript (from `new web --vite`).
- Lives in `~/Developer/cp-site`.
- Compiler: `@yowasp/clang` (LLVM 22, updated Aug 2026, ships libc++ for wasm32-wasip1, plain npm
  package, no special headers or SharedArrayBuffer needed). Wasmer's SDK was ruled out: it needs
  cross-origin isolation headers that GitHub Pages can't set, and downloads packages from Wasmer's registry.
- Fixed flags: `-fno-exceptions -isystem include -Wl,-z,stack-size=268435456`; user flags default `-std=c++20 -O2`.

## Open questions

- Deep recursion: how to support DFS depth 2e5–1e6 in the browser? (blocks "good for CP")
