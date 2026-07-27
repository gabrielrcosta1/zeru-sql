# Zeru

A modern, **AI-native SQL client** for Windows, macOS and Linux — built with **Tauri + Rust + React**. Zeru reimagines the DataGrip / TablePlus / Beekeeper experience for the AI era: visual navigation, a professional SQL editor, and an assistant that understands the connected database — all sharing the same context.

> This repository currently contains the **UI layer only**. Data is served from typed mock fixtures; database drivers and the AI bridge are stubbed for later.

## Stack

- **Tauri 2** (Rust shell) — desktop window, native chrome
- **React 18 + TypeScript** (strict)
- **Vite 5** — dev server & bundler
- **Tailwind CSS 3** — token-driven dark theme
- **Monaco** — SQL editor (bundled locally, works offline)
- **zustand** — UI state
- **react-resizable-panels**, **lucide-react**

## Running

```bash
npm install
npm run dev          # web preview at http://localhost:1420
npm run tauri dev    # full desktop app (requires Rust toolchain)
```

Verification:

```bash
npm run typecheck    # tsc --noEmit  (passes clean)
npm run build        # tsc + vite production build
```

## Architecture

```
src/
├── App.tsx                  # 3-column resizable shell
├── types.ts                 # domain model (Connection, Schema, QueryResult, AiMessage…)
├── store/app.ts             # single zustand store (UI state + simulated exec/AI)
├── lib/
│   ├── cn.ts                # class merge helper
│   ├── format.ts            # row/byte/time formatting
│   ├── export.ts            # CSV / JSON / Excel exporters
│   ├── monaco.ts            # local Monaco wiring (offline)
│   └── mock/                # schema + result/AI/history fixtures
├── components/
│   ├── ui/                  # design-system primitives (Button, Input, Menu, Modal…)
│   ├── shell/               # TitleBar, StatusBar, ResizeHandle
│   ├── sidebar/             # connections + schema tree (tables → columns/PK/FK/indexes)
│   ├── editor/              # tabbed Monaco editor + results split
│   ├── results/             # grid: sort / paginate / search / copy / export, DML feedback
│   ├── ai/                  # persistent assistant panel + SQL cards
│   ├── history/             # recent / favorites / AI / connections
│   └── screens/             # connection modal, table explorer, relationships diagram, ⌘K palette
```

### Design language

A token-driven dark theme (`src/index.css` → CSS variables → Tailwind semantic colors). Deep charcoal surfaces, an **iris** accent, JetBrains Mono for SQL/data, Inter for UI. Soft borders, discreet motion, generous spacing.

### The three interaction modes share one context

Visual navigation, manual SQL, and the AI assistant operate on the same active connection / tab / result. The AI always **shows generated SQL before running it**, and never auto-executes destructive commands (they require explicit confirmation).

## Known follow-ups (backend phase)

- Wire real database drivers in `src-tauri` and expose Tauri commands; replace `lib/mock/*`.
- Connect a real model to the AI panel (schema-aware prompting) via `store/app.ts::sendAi`.
- Trim the Monaco bundle to the SQL language only (currently ships all grammars).
- No ESLint config yet — add one for the backend phase.
