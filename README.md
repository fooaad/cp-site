# cp-site

Competitive programming in C++, entirely in the browser: **https://fooaad.github.io/cp-site/**

Write C++, add test cases with expected output, and press Run. Your code is compiled by Clang
running as WebAssembly in your own browser tab, so there is no server and nothing to install.

- C++17/20/23, `-O2`/`-O0`, `#include <bits/stdc++.h>`
- Test cases with expected output, pass/fail per test and a diff on wrong answers;
  decimal answers can be accepted within ±1e-6 (or ±1e-9, ±1e-4)
- 2 s time limit, time and memory per run, clear runtime-error messages
- Deep recursion works: if a program recurses deeper than the browser allows, it is re-run in an
  interpreter that keeps its call stack in memory ("slow mode", about 25× slower)
- Code, tests and settings are saved in your browser

The first visit downloads the compiler (about 25 MB compressed); after that it's cached.

**Limits:** no C++ exceptions (`throw` won't compile), no `<csetjmp>`/`<csignal>`, Clang and
libc++ rather than GCC (so no `__gnu_pbds`).

## How it works

| Piece | What it does |
|---|---|
| [`@yowasp/clang`](https://yowasp.org/) | Clang/LLD compiled to WebAssembly; compiles your code to a `wasm32-wasi` program |
| `src/cpp/libcxx/` | libc++ rebuilt with optimization (`libcxx/build.sh`); the bundled one is unoptimized, which made `cin`/`cout` 8–30× slower |
| `src/cpp/compiler.worker.ts` | keeps Clang loaded in a Web Worker between runs |
| `src/cpp/runner.worker.ts` | runs one program at a time with stdin/stdout ([browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim)); killed on a time limit |
| `interp/` → `src/cpp/interp.wasm` | the [wasmi](https://github.com/wasmi-labs/wasmi) interpreter with a small WASI layer, for slow mode |

[PLAN.md](PLAN.md) has the build plan, measurements and decisions.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 (and /spike.html for the Phase 0 checks)
npm run build        # production build into dist/
npm run preview      # serve dist/ at http://localhost:4173/cp-site/
node scripts/spike.ts  # compile/run checks in Node
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`).

The two prebuilt pieces are committed, so building the site needs only Node. To rebuild them:

- `npm run build:interp`: needs Rust with the `wasm32-unknown-unknown` target
- `libcxx/build.sh`: needs CMake; downloads wasi-sdk 29 and the matching LLVM sources (~20 s build)

## Third-party code

Clang/LLVM, libc++ and libc++abi: Apache-2.0 with LLVM exceptions. @yowasp/clang: ISC.
wasmi: MIT/Apache-2.0. browser_wasi_shim: MIT/Apache-2.0. CodeMirror: MIT.
