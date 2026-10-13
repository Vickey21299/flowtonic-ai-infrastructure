/**
 * THE SINGLE DEMO SEED (Spec §4, §13).
 *
 * This is the only file where raw demo facts live. Everything the API returns
 * (KPIs, statuses, exceptions, counts, charts) is derived from these facts by
 * `engine.ts` and the per-screen `*.demo.ts` files. Never restate a number elsewhere.
 *
 * All company data is fictional. Values are USD millions for one monthly period.
 */
import type { MetricKey, ReportingPeriod, Rule, SchemaField, SchemaFieldInfo } from '@/api/types'

// ---------- Workspace ----------

/** ASSUMPTION: the spec names no calendar month — the demo period is defined here only. */
export const DEMO_PERIOD: ReportingPeriod = { key: '2026-09', label: 'Sep 2026', type: 'month' }

export const WORKSPACE_META = {
  name: 'Demo Fund I',
  environment: 'demo' as const,
  currency: 'USD',
  unit: 'millions' as const,
  demoUser: { name: 'Demo User', role: 'Operating Partner' },
  methodologyVersion: '1.0',
}

/** Demo actor names used by audit trails. */
export const SYSTEM_ACTOR = 'System (rules engine)'

// ---------- Companies (Spec §13; sectors are ASSUMPTIONS) ----------

export interface SeedCompany {
  id: string
  name: string
  sector: string
  currency: string
  createdAt: string
}

export const SEED_COMPANIES: SeedCompany[] = [
  {
    id: 'northstar-components',
    name: 'Northstar Components',
    sector: 'Industrial components',
    currency: 'USD',
    createdAt: '2026-10-05T09:30:00Z',
  },
  {
    id: 'apex-field-services',
    name: 'Apex Field Services',
    sector: 'Field services',
    currency: 'USD',
    createdAt: '2026-10-05T09:30:00Z',
  },
  {
    id: 'meridian-distribution',
    name: 'Meridian Distribution',
    sector: 'Distribution',
    currency: 'USD',
    createdAt: '2026-10-05T09:30:00Z',
  },
]

// ---------- The seed import (provenance for every seed observation) ----------

export const SEED_IMPORT = {
  id: 'JOB-0001',
  fileName: 'portfolio_2026-09.csv',
  importedAt: '2026-10-05T09:30:00Z',
  importedBy: 'Demo User',
}

export const SEED_SOURCE = {
  name: 'Monthly management accounts (fictional)',
  updatedAt: '2026-10-03T00:00:00Z',
}

/**
 * The rows of the seed import file, exactly as the original CSV strings.
 * Row numbers count the header as row 1.
 */
export interface SeedSourceRow {
  sourceRow: number
  values: Record<SchemaField, string>
}

const row = (
  sourceRow: number,
  company: SeedCompany,
  revenueActual: string,
  revenuePlan: string,
  ebitdaActual: string,
  ebitdaPlan: string,
): SeedSourceRow => ({
  sourceRow,
  values: {
    company_id: company.id,
    company_name: company.name,
    sector: company.sector,
    reporting_period: DEMO_PERIOD.key,
    revenue_actual: revenueActual,
    revenue_plan: revenuePlan,
    ebitda_actual: ebitdaActual,
    ebitda_plan: ebitdaPlan,
    source_name: SEED_SOURCE.name,
    source_updated_at: SEED_SOURCE.updatedAt,
  },
})

const [northstar, apex, meridian] = SEED_COMPANIES as [SeedCompany, SeedCompany, SeedCompany]

export const SEED_SOURCE_ROWS: SeedSourceRow[] = [
  row(2, northstar, '24.6', '24.0', '3.20', '3.12'),
  row(3, apex, '10.8', '11.2', '1.62', '1.90'),
  row(4, meridian, '18.1', '18.8', '2.17', '2.35'),
]

// ---------- Rules (one active configuration, version 1) ----------

export const SEED_RULE_CONFIGURATION = {
  version: 1,
  activatedAt: '2026-10-01T00:00:00Z',
  rules: [
    {
      id: 'rule-ebitda-high',
      key: 'EBITDA_VAR_HIGH',
      label: 'EBITDA variance — high priority',
      kpiKey: 'ebitda_variance_pct',
      comparator: 'lte',
      threshold: -10,
      severity: 'high',
      enabled: true,
    },
    {
      // ASSUMPTION: the spec asks for "a less severe configurable deviation"; −5% is our demo value.
      id: 'rule-ebitda-warn',
      key: 'EBITDA_VAR_WARN',
      label: 'EBITDA variance — warning',
      kpiKey: 'ebitda_variance_pct',
      comparator: 'lte',
      threshold: -5,
      severity: 'warning',
      enabled: true,
    },
    {
      id: 'rule-revenue',
      key: 'REVENUE_VAR',
      label: 'Revenue variance',
      kpiKey: 'revenue_variance_pct',
      comparator: 'lte',
      threshold: -5,
      severity: 'medium',
      enabled: true,
    },
  ] satisfies Rule[],
}

// ---------- Import schema (Spec §6) ----------

export const IMPORT_SCHEMA: SchemaFieldInfo[] = [
  { field: 'company_id', label: 'Company ID', required: true, description: 'Stable identifier of the portfolio company.' },
  { field: 'company_name', label: 'Company name', required: true, description: 'Display name of the company.' },
  { field: 'sector', label: 'Sector', required: false, description: 'Sector used for filtering.' },
  { field: 'reporting_period', label: 'Reporting period', required: true, description: 'Month in YYYY-MM format, e.g. 2026-09.' },
  { field: 'revenue_actual', label: 'Revenue actual', required: true, description: 'Plain number in USD millions, no symbols.' },
  { field: 'revenue_plan', label: 'Revenue plan', required: true, description: 'Plain number in USD millions. Zero or empty makes revenue variance % not calculable.' },
  { field: 'ebitda_actual', label: 'EBITDA actual', required: true, description: 'Plain number in USD millions, no symbols.' },
  { field: 'ebitda_plan', label: 'EBITDA plan', required: true, description: 'Plain number in USD millions. Zero or empty makes EBITDA variance % not calculable.' },
  { field: 'source_name', label: 'Source name', required: false, description: 'Where the figures come from. Defaults to the file name.' },
  { field: 'source_updated_at', label: 'Source updated at', required: false, description: 'ISO 8601 date the source was last updated.' },
]

/** Metric ↔ import columns. */
export const METRIC_COLUMNS: Record<'revenue' | 'ebitda', { actual: SchemaField; plan: SchemaField }> = {
  revenue: { actual: 'revenue_actual', plan: 'revenue_plan' },
  ebitda: { actual: 'ebitda_actual', plan: 'ebitda_plan' },
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: 'Revenue',
  ebitda: 'EBITDA',
  ebitda_margin: 'EBITDA margin',
}

// ---------- Sample CSV (Spec §6) ----------

export const SAMPLE_CSV_FILE_NAME = 'flowtonic_sample_2026-09.csv'

/**
 * One deliberately invalid row, appended after the seed rows.
 * ebitda_actual is not a number, so the row must be reported, never silently dropped.
 */
export const SAMPLE_INVALID_ROW: Record<SchemaField, string> = {
  company_id: 'harbor-logistics',
  company_name: 'Harbor Logistics',
  sector: 'Logistics',
  reporting_period: DEMO_PERIOD.key,
  revenue_actual: '9.4',
  revenue_plan: '9.0',
  ebitda_actual: 'n/a',
  ebitda_plan: '1.10',
  source_name: SEED_SOURCE.name,
  source_updated_at: SEED_SOURCE.updatedAt,
}

// ---------- Mock investigation template (Spec §9, §13) ----------

/**
 * Deterministic mock template. It contains NO causal claims: every explanation is
 * phrased as a possibility and names the evidence that has not been supplied.
 * The evidence values are filled in from the exception at generation time.
 */
export const MOCK_INVESTIGATION_TEMPLATE = {
  modelMetadata: {
    provider: 'none (mock)',
    model: 'Deterministic template — not an AI model',
    promptVersion: 'mock-template-v1',
  },
  missingEvidence: [
    {
      id: 'sales_volume',
      type: 'Sales volume',
      whyNeeded: 'Separates a change in units sold or jobs completed from a change in price.',
    },
    {
      id: 'pricing',
      type: 'Pricing',
      whyNeeded: 'Shows whether average prices or rates moved against plan.',
    },
    {
      id: 'operating_expenses',
      type: 'Operating expenses',
      whyNeeded: 'Shows whether costs moved against plan and which cost lines changed.',
    },
    {
      id: 'customer_data',
      type: 'Customer data',
      whyNeeded: 'Shows whether customer mix, losses or new contracts differ from plan.',
    },
  ],
  explanations: [
    {
      id: 'exp-volume',
      statement: 'Lower sales volume could contribute to the variance, but sales-volume data has not been supplied.',
      missing: ['sales_volume'],
      supportedBy: 'revenue_below_plan' as const,
    },
    {
      id: 'exp-pricing',
      statement: 'Lower average pricing could contribute to the variance, but pricing data has not been supplied.',
      missing: ['pricing'],
      supportedBy: 'revenue_below_plan' as const,
    },
    {
      id: 'exp-costs',
      statement: 'Operating costs above plan could contribute to the variance, but operating-expense data has not been supplied.',
      missing: ['operating_expenses'],
      supportedBy: 'margin_below_plan' as const,
    },
    {
      id: 'exp-customers',
      statement: 'A change in customer mix or customer losses could contribute to the variance, but customer data has not been supplied.',
      missing: ['customer_data'],
      supportedBy: null,
    },
  ],
  managementQuestions: [
    { question: 'How did sales volume (units sold or jobs completed) compare with plan this month?', explanations: ['exp-volume'] },
    { question: 'Did average prices or rates differ from the plan assumptions?', explanations: ['exp-pricing'] },
    { question: 'Which operating-expense lines differed most from plan, and why?', explanations: ['exp-costs'] },
    { question: 'Were there any customer losses, new contracts or changes in customer mix during the month?', explanations: ['exp-customers'] },
  ],
  nextSteps: [
    { step: 'Request monthly sales-volume and pricing data for the period.', type: 'data_request' as const },
    { step: 'Request an operating-expense breakdown against plan.', type: 'data_request' as const },
    { step: 'Request customer-level revenue for the period and the prior months.', type: 'data_request' as const },
    { step: 'Compare the requested data with plan to test each explanation.', type: 'analysis' as const },
    { step: 'Hold a review call with company management once the data is received.', type: 'meeting' as const },
  ],
  suggestedActions: [
    {
      title: 'Request supporting operating data from management',
      rationale: 'The supplied data cannot distinguish between the possible explanations. Volume, pricing, cost and customer data are needed first.',
      explanations: ['exp-volume', 'exp-pricing', 'exp-costs', 'exp-customers'],
    },
    {
      title: 'Schedule a variance review with the management team',
      rationale: 'Management can confirm or rule out each explanation once the data is available.',
      explanations: ['exp-volume', 'exp-pricing', 'exp-costs', 'exp-customers'],
    },
  ],
  dataLimitations: [
    'Only the reporting periods stored in the workspace are available; with a single period no trend can be assessed.',
    'No sales-volume, pricing, operating-expense or customer data has been supplied.',
    'Plan figures are taken as provided by the source and have not been independently verified.',
    'This is a deterministic mock output, not generated by an AI model.',
  ],
}
