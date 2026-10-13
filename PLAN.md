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

- [ ] Compare Clang-for-Wasm options (YoWASP clang, Wasmer clang, others): maintained? C++17/20? libc++ included? size?
- [ ] Compile A+B (`cin >> a >> b; cout << a + b;`) to `wasm32-wasi` in the browser
- [ ] Run it with a WASI shim (e.g. `@bjorn3/browser_wasi_shim`), stdin `3 4` → stdout `7`
- [ ] Measure: download size, first compile time, repeat compile time
- [ ] Record the choice and numbers under Decisions

Done when: A+B works in the browser and the numbers are written down.

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

## Open questions

- Which Clang-for-Wasm package? (Phase 0)
