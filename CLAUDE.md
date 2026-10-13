# cp-site

Browser-only competitive programming site: C++ is compiled and run in the browser
(Clang compiled to WebAssembly, run in a Web Worker). Static hosting on GitHub Pages,
so there is no server: never add a backend or put API keys in the frontend.
Built with Vite + React + TypeScript.

## Working on it

- `PLAN.md` is the source of truth: read it first, work on the current phase only,
  tick boxes and record decisions there when something is done.
- A change is done when `npm run build` passes and you have checked it in the browser
  preview (for compiler work: compile and run A+B and see the right output).
- Commit after each working step, not at the end.

## Commands

- `npm run dev` — dev server on http://localhost:5173 (also the `dev` entry in `.claude/launch.json`)
- `npm run build` — type-check (`tsc -b`) and build into `dist/`; run it before calling a change done
- `npm run lint` — lint with oxlint
- `npm run preview` — serve the built `dist/` locally

## Layout

- `src/main.tsx` — entry point; `src/App.tsx` — root component
- `src/assets/` — images and files imported from code
- `public/` — static files served as-is at `/`

## Environment variables

- Real values go in `.env.local` (git-ignored). List every variable in `.env.example`.
- Only `VITE_`-prefixed variables reach the browser, and anything in the browser is public. Never put secrets in them.
