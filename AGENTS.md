# Repository Guidelines

## Project Structure & Module Organization
This repository is a workspace of small full-stack apps under `workspace/`.
- `workspace/linkpro`, `workspace/tokka`, `workspace/shopping`, `workspace/todo_app_01`: Node.js + Express apps with single-entry backend (`server.js`) and frontend (`index.html`).
- `workspace/recipe`: content and utility scripts for recipe assets (`generate_image.py`, `.md`, `.png`).
- App-level environment templates are stored as `.env.example`; deployment settings live in `vercel.json`.

Keep new features scoped to the target app directory. Avoid cross-app coupling unless explicitly required.

## Build, Test, and Development Commands
Run commands inside the specific app folder:
- `npm install`: install dependencies.
- `npm start`: start the app (`node server.js`).
- `npm run dev`: dev run (available in `linkpro`, `tokka`, `todo_app_01`).
- `npm run setup-db`: initialize database schema/data (`tokka`).
- `node setup-db.js`: database setup script for apps that ship the file directly (for example `shopping`).

Example:
```bash
cd workspace/linkpro
npm install
npm run dev
```

## Coding Style & Naming Conventions
- Use 2-space indentation in JavaScript/HTML files; keep semicolon and quote usage consistent with surrounding code.
- Prefer clear file names used in this repo: `server.js`, `setup-db.js`, `index.html`.
- Keep API routes grouped by domain and use descriptive names (for example `/api/auth/login`, `/api/products`).
- Store secrets only in `.env`/`.env.local`; never commit real credentials.

## Testing Guidelines
There is currently no unified automated test suite in `package.json`. When adding functionality:
- Add focused tests with the framework you introduce (recommended: `jest` + `supertest` for Express).
- Name test files `*.test.js` and place them near related server code or in `tests/`.
- At minimum, verify critical paths manually (auth, DB write flows, and error handling) before opening a PR.

## Commit & Pull Request Guidelines
Follow the repository’s Conventional Commit style seen in history:
- `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`
- Examples: `feat(linkpro): add dashboard reorder`, `fix(linkpro): block token bypass`

PRs should include:
- What changed and why (short summary).
- Affected app path(s), for example `workspace/tokka`.
- Manual verification steps and results.
- UI screenshots/video for `index.html` changes.
