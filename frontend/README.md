# Frontend

The Flownetic web application: what the user sees and clicks.

> Status: **not implemented yet.** This folder currently contains design documents only.

## Tech stack (planned)

- React + TypeScript (single-page app)
- Client-side router (no full-page reloads)
- Server-state cache (e.g. TanStack Query) for API data
- Charting library (e.g. Recharts)
- Playwright for end-to-end tests

## Planned folder structure

```
frontend/
├── src/
│   ├── app/          # router, layout (nav, header, demo notice)
│   ├── pages/        # one folder per screen
│   ├── features/     # import wizard, exception detail, investigation panel, forms
│   ├── components/   # shared UI: KpiCard, DataTable, Chart, FilterBar, Drawer, ...
│   └── api/          # typed API client
└── tests/
```

## Run

To be added when the app is built. The backend must be running, because all data comes from its API.

## Design

See [system.md](system.md).
