# Frontend Build Plan — Flowtonic Portfolio Intelligence

## Context

The repo currently holds design documents only (`system.md`, `flowtonic.txt`, and `frontend/`, `backend/`, `database/` docs). No application code exists.

We are building the **frontend first**, before the backend exists. The goal is a clickable, demoable React app that walks the Spec §16 sales demonstration end to end (Overview → Apex Field Services → EBITDA exception → investigation → action → impact → back to Overview), driven by demo data files that mirror the future API responses exactly.

**Decisions made with the user:**

| Decision | Choice |
|---|---|
| Data source | Per-screen demo data files, derived from one shared seed |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives, copied into repo) |
| Detail views | Side drawer that owns its own URL (deep-linkable, refresh-safe) |
| Build order | Shell → Spec §16 demo path → remaining screens |

---

## Screen inventory

**8 navigation items** (Spec §2), **13 routable views**. The spec's "Screen Four — KPI Calculation Engine" is backend logic, not a UI screen.

| # | View | Route | Nav item | Spec |
|---|---|---|---|---|
| 1 | Portfolio Overview | `/` | Overview | §4 |
| 2 | Portfolio Companies | `/companies` | Portfolio Companies | §4 |
| 3 | Company Detail (5 tabs) | `/companies/:id` | — (sub-view) | §5 |
| 4 | Exceptions list | `/exceptions` | Exceptions | §8 |
| 5 | Exception Detail | `/exceptions/:id` | — (drawer) | §8 |
| 6 | Investigations list | `/investigations` | Investigations | §9 |
| 7 | Investigation Detail | `/investigations/:id` | — (drawer) | §9 |
| 8 | Actions list | `/actions` | Actions | §10 |
| 9 | Action Detail / Edit | `/actions/:id` | — (drawer) | §10 |
| 10 | Impact Tracking | `/impact` | Impact Tracking | §11 |
| 11 | Import wizard (4 steps) | `/import` | — (under Data & Methodology) | §6 |
| 12 | Data & Methodology | `/methodology` | Data & Methodology | §12 |
| 13 | Settings | `/settings` | Settings | §2 |

Company Detail tabs (Spec §5): Performance, Exceptions, Investigations, Actions, Data History.
Import wizard steps (Spec §6): Upload → Map columns → Preview & errors → Confirm → Summary.

---

## Stack

| Concern | Choice |
|---|---|
| Build tool | Vite |
| Framework | React 18 + TypeScript (strict) |
| Routing | React Router v6 (`createBrowserRouter`) |
| Server state | TanStack Query |
| Styling | Tailwind CSS |
| Components | shadcn/ui (Table, Dialog, Sheet/Drawer, Tabs, Select, Badge, Button, Form) |
| Charts | Recharts |
| Money/percent formatting | `Intl.NumberFormat` |
| Lint/format | ESLint + Prettier |
| E2E (Phase 8) | Playwright |

Install shadcn components individually as each screen needs them — do not bulk-add.

---

## Folder structure

```
frontend/
├── index.html
├── package.json          tailwind.config.ts   tsconfig.json   vite.config.ts
└── src/
    ├── main.tsx
    ├── app/
    │   ├── router.tsx            # all 13 routes, drawer routes as children
    │   ├── AppShell.tsx          # left nav + header + demo notice + <Outlet/>
    │   ├── Header.tsx            # wordmark, workspace, period selector, freshness, user menu
    │   ├── SideNav.tsx           # 8 nav items, collapsible
    │   └── DemoNotice.tsx        # "DEMO ENVIRONMENT — ALL COMPANY DATA IS FICTIONAL."
    ├── pages/
    │   ├── overview/   companies/   exceptions/   investigations/
    │   ├── actions/    impact/      import/       methodology/   settings/
    ├── components/               # shared, screen-agnostic
    │   ├── KpiCard.tsx           DataTable.tsx     FilterBar.tsx
    │   ├── StatusBadge.tsx       SeverityBadge.tsx VarianceValue.tsx
    │   ├── DetailDrawer.tsx      TraceView.tsx     MetricValue.tsx
    │   ├── charts/               ActualVsPlanChart.tsx  StatusDonut.tsx  SeverityBarChart.tsx
    │   └── states/               Loading.tsx  Empty.tsx  ErrorState.tsx
    ├── api/                      # async accessors — the seam to the real backend
    │   ├── types.ts              # API response types (shared with backend later)
    │   ├── overview.ts  companies.ts  exceptions.ts  investigations.ts
    │   └── actions.ts   impact.ts     imports.ts     methodology.ts  settings.ts
    ├── demo/                     # demo data, deleted when backend lands
    │   ├── seed.ts               # ← SINGLE SOURCE: 3 spec companies + derived KPIs
    │   ├── store.ts              # in-memory mutable state for status changes
    │   ├── overview.demo.ts      companies.demo.ts    exceptions.demo.ts
    │   ├── investigations.demo.ts  actions.demo.ts    impact.demo.ts
    │   └── import.demo.ts        methodology.demo.ts  settings.demo.ts
    └── lib/
        ├── format.ts             # currency, percent, pp, "—" for missing
        └── queryKeys.ts
```

---

## Demo data architecture

This is the part to get right, because Spec §4 forbids independently hardcoded counts.

**Rule: one seed, everything else derived.**

`src/demo/seed.ts` holds the Spec §13 companies and their *pre-computed* KPI results — computed once, by hand, matching what the backend will return:

| Company | Rev act / plan | Rev var % | EBITDA act / plan | EBITDA var % | Margin act / plan | Margin var | Status |
|---|---|---|---|---|---|---|---|
| Northstar Components | 24.6 / 24.0 | +2.50% | 3.20 / 3.12 | +2.56% | 13.01% / 13.00% | +0.01 pp | On track |
| Apex Field Services | 10.8 / 11.2 | −3.57% | 1.62 / 1.90 | **−14.74%** | 15.00% / 16.96% | −1.96 pp | **Exception** |
| Meridian Distribution | 18.1 / 18.8 | −3.72% | 2.17 / 2.35 | −7.66% | 11.99% / 12.50% | −0.51 pp | Warning |

All USD millions, one monthly period. Thresholds: EBITDA ≤ −10% high, ≤ −5% warning, revenue ≤ −5% optional.

**Each `*.demo.ts` derives its view from `seed.ts`** — it never restates a number:

```ts
// demo/overview.demo.ts
import { companies, exceptions, actions } from './seed'

export const overviewDemo = (): OverviewResponse => ({
  cards: {
    companies: companies.length,                                        // 3
    requiringAttention: companies.filter(c => c.status !== 'on_track').length,  // 2
    openHighExceptions: exceptions.filter(e => e.severity === 'high' && e.status !== 'resolved').length,
    overdueActions: actions.filter(isOverdue).length,
    awaitingVerification: actions.filter(a => a.status === 'completed').length,
  },
  rows: companies.map(toOverviewRow),
  charts: { /* derived from companies */ },
  freshness: seedMeta.lastImportAt,
})
```

**The frontend does not calculate KPIs.** Variance and margin values live in `seed.ts` as given facts (the backend's job, per Spec §7). Screens only format and display them. The *only* derivation allowed in demo files is counting, filtering and sorting records — exactly what the backend's read model will do.

**`src/api/*.ts` is the swap seam.** Screens never import from `demo/`:

```ts
// api/overview.ts — today
export async function getOverview(f: Filters): Promise<OverviewResponse> {
  await delay(300)                       // exercises real loading states
  return overviewDemo(f)
}
// api/overview.ts — when backend lands (only this line changes)
// return fetch(`/api/v1/overview?${qs(f)}`).then(unwrap)
```

`demo/store.ts` holds mutable in-memory state so status changes (acknowledge an exception, move an action to In progress, record an impact) persist across navigation within a session and the Overview counts visibly update — which Spec §16 step 14 requires. State resets on page reload; that is acceptable and will be noted in the README.

---

## Build phases

### Phase 1 — Project setup and app shell
Scaffold Vite + React + TS (strict) in `frontend/`. Tailwind with the Spec §3 token scale: near-black/white/grey, one muted accent, red/amber/green reserved for status only. Router with all 13 routes registered (placeholder pages). `AppShell` with collapsible left nav (8 items), header (wordmark, workspace, reporting-period selector, data-freshness indicator, demo-user menu), and the persistent demo notice.

**Done when:** every nav item routes without a full page reload; shell is correct at desktop and mobile widths; `tsc --noEmit` and lint pass.

### Phase 2 — Primitives and demo seed
Build `seed.ts` with the table above plus derived exceptions (one high on Apex, one warning on Meridian), an empty actions/impact list, and one pre-written mock investigation for Apex. Build `lib/format.ts` (missing → `—`, never `0`), `KpiCard`, `DataTable` (sort, search, filter, paginate), `StatusBadge`, `SeverityBadge`, `VarianceValue` (sign colouring, `%` vs `pp`), and the three `states/` components.

**Done when:** primitives render from seed data in isolation; `DataTable` sorts/filters/paginates; a missing value renders `—` and a zero renders `0`.

### Phase 3 — Overview + Companies + Company Detail *(Spec §16 steps 1–4)*
Overview: 5 KPI cards (each navigating to its filtered view via URL params), portfolio table with all 15 Spec §4 columns, and the 4 charts. Companies list reusing `DataTable`. Company Detail with header and the 5 tabs; Performance tab shows actual-vs-plan charts built **only from periods present in the seed** — no invented history (Spec §5).

**Done when:** cards read 3 / 2 / 1 / 0 / 0; the table matches the seed table above; clicking a card lands on a correctly filtered list; Apex detail shows −14.74%.

### Phase 4 — Exceptions + drawer + trace *(Spec §16 steps 5–6)*
Exceptions list with the Spec §8 columns and six filters. `DetailDrawer` pattern: `/exceptions` renders the list, `/exceptions/:id` renders list + open drawer; Esc and browser-back close it; refresh reopens it. Drawer shows metric, actual vs plan, the exact calculation `(1.62 − 1.90) / 1.90 × 100 = −14.74%`, the rule and threshold, source and freshness, and linked records. `TraceView` chains rule → formula → observation → import job → source row.

**Done when:** `/exceptions/apex-ebitda` deep-links correctly after refresh; opening an exception does **not** change its status (Spec §8).

### Phase 5 — Investigations *(Spec §16 steps 7–8)*
Investigation panel rendering all ten Spec §9 output parts, with confirmed facts visually separated from hypotheses. A persistent **"MOCK INVESTIGATION — not generated by an AI model"** badge. Controls: Generate, Regenerate, Add notes, Edit, Save, Mark reviewed, Create proposed action. The Apex mock states cause **undetermined** and requests sales volume, pricing, operating expenses and customer data.

**Done when:** no causal claim appears anywhere; the mock label is unmissable; "Create proposed action" opens a pre-filled form that still requires owner and due date.

### Phase 6 — Actions + Impact *(Spec §16 steps 9–13)*
Action form and list with overdue/priority filters. Status control that offers only legal transitions from the current state and blocks the rest with a reason. Completion requires notes and evidence. Impact form keeping baseline, target, estimate and observed values visually distinct; verification blocked without observation + source + reviewer + evidence, leaving the record **unverified**.

**Done when:** an invalid transition shows an error instead of succeeding; an impact cannot be forced to Verified; Overview's "awaiting verification" count updates after completing an action.

### Phase 7 — Import wizard, Methodology, Settings
Four-step wizard against `import.demo.ts`, including one deliberately invalid row surfaced with row number, field and reason, plus cancel and an import summary. Methodology screen showing formulas, thresholds, sources, missing data and limitations. Settings for thresholds and AI mode (editing thresholds updates `store.ts`, re-deriving statuses).

**Done when:** the invalid row is reported and never silently dropped; cancel discards cleanly; lowering the EBITDA threshold to −15% visibly clears the Apex exception.

### Phase 8 — Polish and acceptance
Walk the full Spec §16 14-step script. Verify no dead buttons, no console errors, keyboard navigation and focus states throughout, accessible contrast, and usability at mobile width. Add Playwright coverage for the 14-step path. Write `frontend/README.md` run instructions and a note that demo state resets on reload.

**Done when:** the Spec §17 "General" checklist passes and the Playwright demo spec is green.

---

## Verification

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run lint
npm run test:e2e     # Playwright, from Phase 8
```

Manual acceptance — the Spec §16 script, which must work with no code edits between steps:

1. Overview shows 3 companies, 2 requiring attention, 1 open high-priority exception.
2. Company table values match the seed table.
3. Click Apex Field Services → detail page.
4. Revenue 10.8 vs 11.2 (−3.57%); EBITDA 1.62 vs 1.90 (−14.74%); margin 15.00% vs 16.96% (−1.96 pp).
5. Open the EBITDA exception → High severity, status unchanged by viewing.
6. Formula and `≤ −10%` threshold shown, traceable to the source row.
7. Generate investigation → clearly labelled MOCK.
8. Facts separated from hypotheses; missing evidence requested; no cause asserted.
9–10. Create a proposed action, assign owner and due date.
11. Advance Approved → In progress → Completed; confirm an illegal jump is refused.
12. Add an impact record with baseline and target.
13. Attempt verification without evidence → refused, stays unverified.
14. Return to Overview → counts reflect the new action and impact.

Cross-check: Overview counts must always equal what the Exceptions and Actions lists contain (the single-seed rule).

---

## Out of scope for this plan

Backend implementation, database and migrations, real AI provider calls, authentication, and the production requirements in Spec §18. The `api/` layer is the seam where the backend attaches later.

## Open questions (not blocking)

1. Which calendar month does the demo period represent? Spec §13 says only "one monthly period" — needs a label for the period selector.
2. Is the optional revenue exception rule (≤ −5%) enabled by default? No seed company triggers it either way.
3. Should the import wizard be its own nav item, or stay a route reached from Data & Methodology? Plan assumes the latter, since Spec §2 lists only 8 nav items.
