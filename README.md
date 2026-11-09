# DAGMAWIT money app

Income, expenses, loans and reports for the atelier. TypeScript + Vite, data in Supabase.

## Just want to put it online?
Upload the **`dist`** folder: it is already built and ready (Netlify drag-and-drop, Vercel, or any static hosting).
The Supabase address and key are in `dist/config.js` and can be edited without rebuilding.
First-time setup (Supabase, accounts, security) is in **DEPLOYMENT-GUIDE.md**; what changed is in **CHANGES.md**.

## Working on the code
Needs Node.js 20 or newer.

```bash
npm install          # once
npm run dev          # local preview at http://localhost:5173 (uses the real Supabase from public/config.js)
npm test             # unit tests: money rules, data upgrade, suggestions, two-phone merge
npm run typecheck    # strict TypeScript check
npm run build        # type check + build into dist/  ← upload this folder
```

Browser tests (two simulated phones + every screen, against the built `dist`):
```bash
pip install playwright && python -m playwright install chromium
npm run build && python3 -I tests/e2e/run_e2e.py dist tests/e2e/out
```

### Hosting from GitHub (optional, builds automatically)
Push this folder to a GitHub repository, then in Netlify or Vercel choose **Import from Git** with
build command `npm run build` and output folder `dist`. Every push then publishes a new version.

## How the code is organised (`src/`)
| File | What it does |
|---|---|
| `types.ts` | The shape of the data (orders, payments, expenses, loans…). |
| `util.ts` | Dates (always local time), numbers, text helpers. |
| `model.ts` | **All money rules** in one place, the one-time data upgrade, work/home and category suggestions, and the record-by-record merge. No screen code: fully unit-tested. |
| `sync.ts` | Saving to Supabase safely (conditional saves + merge), offline edits, backups. |
| `registry.ts` | Tables linking buttons and pages to code (no imports, so no cycles). |
| `ui.ts` | App shell: pages, bottom sheets, toasts with Undo, hide-money, sync status. |
| `screens.ts` | The pages (read only). |
| `forms.ts` | Every sheet and form that changes data. |
| `main.ts` | Start-up and sign-in. |
| `icons.ts` | Inline icons; `IconName` makes a mistyped icon a compile error. |

Rules the code keeps:
- Data fields this app doesn't use (planner data such as measurements, events, delivery dates) are never removed.
- Customer records are never overwritten from here (view only).
- Money is dated by when it moved; loans and assets change cash, not profit.
- Pages only read; all changes go through a form, then `commit()` (save + refresh).
