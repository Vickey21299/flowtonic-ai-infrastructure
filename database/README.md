# Database

Schema, entities and relationships for Flowtonic.

> Status: **not implemented yet.** This folder currently contains design documents only.

## Choice

| Environment | Database | Reason |
|---|---|---|
| Demo | SQLite (single file) | No setup; easy to reset |
| Production | PostgreSQL | Relational, robust, concurrent access |

The schema is written to work on both, so the demo can move to PostgreSQL without a redesign.

## Planned folder structure

```
database/
├── migrations/     # versioned schema changes
├── seed/           # fictional demo data (flowtonic.txt §13)
└── system.md       # entities, fields, ER diagram
```

## Rules

- Every table has a stable, opaque ID.
- Foreign keys and uniqueness are enforced by the database, not only in code.
- Money is stored as decimal, never as a float.
- Imported values are kept with their source. Corrections supersede old values instead of overwriting them.
- Calculated KPI values are stored in one place only.

## Design

See [system.md](system.md) for the entities and the ER diagram.
