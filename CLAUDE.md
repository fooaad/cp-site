# cp-site

Website built with Vite + React + TypeScript.

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
