# Backend — System Design

The backend does all the work: it validates data, calculates KPIs, detects exceptions, runs investigations, and controls action and impact status. It is a **modular monolith**: one server with separate modules.

## Layers

```mermaid
flowchart TB
    API["API layer<br/>routes · input validation · error responses"] --> S["Module services<br/>run each use case, own the transaction"]
    S --> D["Business logic<br/>formulas · rules · status workflows · validators"]
    S --> R["Database access"]
    R --> DB[("Database")]
    S --> AI["AI adapter<br/>live or mock"]
```

## Modules

| Module | Job |
|---|---|
| Import | Read CSV, map columns, validate rows, preview, confirm or cancel |
| KPI | Calculate variances and margins (decimal maths, same input → same result) |
| Rules | Compare KPIs with the configured thresholds and create or update exceptions |
| Exceptions | Acknowledge, assign, resolve, reopen; keep history |
| Investigations | Collect evidence, call AI or mock, validate the answer, save it for human review |
| Actions | Proposed → Approved → In progress → Completed → Outcome verification → Verified / Reopened (or Cancelled) |
| Impact | Baseline, target and observed values; verification |
| Config | Thresholds, metric definitions, AI mode, demo reset |

```mermaid
flowchart LR
    Import --> KPI --> Rules --> Exceptions
    Investigations --> Exceptions
    Actions --> Exceptions
    Impact --> Actions
    KPI --> Config
    Rules --> Config
```

## Main flows

### 1. CSV import → KPIs → exceptions

```mermaid
flowchart TB
    A[Upload CSV] --> B[Parse + map columns] --> C[Validate rows]
    C --> D[Return preview + row errors]
    D --> E{User confirms?}
    E -- No --> X[Cancel, nothing saved]
    E -- Yes --> T
    subgraph T["One database transaction"]
        F[Save valid rows + source info] --> G[Calculate KPIs] --> H[Check rules] --> I[Create / update exceptions]
    end
    T -- success --> J[Return import summary]
    T -- error --> K[Roll back everything, report failure]
```

Invalid rows are never silently dropped. They are reported with row number, field and reason.

### 2. Investigation (AI or mock)

```mermaid
flowchart TB
    A[User clicks Generate] --> B[Collect evidence:<br/>KPIs, history, notes, missing data]
    B --> C{AI key configured?}
    C -- Yes --> D[Call AI provider<br/>timeout + retry]
    C -- No --> E[Mock investigation]
    D & E --> F{Answer valid?<br/>schema + facts match data}
    F -- Yes --> G[Save: facts, hypotheses,<br/>missing evidence, suggestions]
    F -- No --> H[Save as failed,<br/>offer retry or mock]
    G --> I[Human reviews and decides on actions]
```

The AI never calculates numbers and never claims a cause without evidence.

### 3. Action and impact

```mermaid
stateDiagram-v2
    [*] --> Proposed
    Proposed --> Approved: owner + due date
    Approved --> InProgress
    InProgress --> Completed: completion evidence
    Completed --> OutcomeVerification: impact recorded
    OutcomeVerification --> Verified: evidence confirmed
    OutcomeVerification --> Reopened: not confirmed
    Reopened --> InProgress
    Proposed --> Cancelled: reason
    Approved --> Cancelled: reason
    InProgress --> Cancelled: reason
```

An impact record starts as **unverified** (or **not yet measurable**). It becomes verified only when an observed value, its source, a reviewer and supporting evidence are recorded.

## API

| Group | Endpoints |
|---|---|
| Overview | `GET /overview` |
| Companies | `GET /companies`, `GET /companies/{id}` |
| Imports | `POST /imports`, `PUT /imports/{id}/mapping`, `POST /imports/{id}/confirm`, `POST /imports/{id}/cancel` |
| Exceptions | `GET /exceptions`, `GET /exceptions/{id}`, `POST /exceptions/{id}/transitions`, `GET /exceptions/{id}/trace` |
| Investigations | `POST /exceptions/{id}/investigations`, `GET /investigations/{id}`, `POST /investigations/{id}/review` |
| Actions | `POST /actions`, `PATCH /actions/{id}`, `POST /actions/{id}/transitions` |
| Impact | `POST /actions/{id}/impacts`, `POST /impacts/{id}/verification` |
| Config | `GET /methodology`, `GET/PUT /settings`, `POST /demo/reset`, `GET /health` |

Errors use one shape: `{ code, message, details, request_id }`. Status codes: `422` invalid input, `409` invalid status change.

## Backend rules

- API keys live only in server environment variables.
- Multi-step writes use one transaction: everything is saved or nothing is.
- Repeating an import or rule check never creates duplicates.
- Every status change is recorded in the audit history.
- Demo reset works only in the `demo` profile.
