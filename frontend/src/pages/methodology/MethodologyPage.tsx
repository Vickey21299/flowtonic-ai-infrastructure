import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileUp, Settings } from 'lucide-react'
import { api } from '@/api'
import type { MethodologyResponse } from '@/api/types'
import { SourceLabel } from '@/components/AiLabel'
import { PageHeader } from '@/components/PageHeader'
import { Section } from '@/components/Section'
import { SeverityBadge } from '@/components/StatusBadges'
import { ErrorState } from '@/components/states/ErrorState'
import { Loading } from '@/components/states/Loading'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, formatPeriod, investigationModeLabel } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { ruleConditionText } from '../ruleFormat'

const unitLabel = { currency: 'USD m', pct: '%', pp: 'pp' } as const

function SimpleTable({ caption, head, children }: { caption: string; head: ReactNode[]; children: ReactNode }) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {head.map((h, i) => (
            <TableHead key={i}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{children}</p>
}

function Content({ m }: { m: MethodologyResponse }) {
  const cfg = m.ruleConfiguration
  return (
    <div className="space-y-6">
      <Alert variant="info" title="Demo environment — fictional data">
        All companies and figures are fictional. Data is monthly and periodic, not real-time: latest period{' '}
        <strong>{m.period.label}</strong>, last import {formatDateTime(m.lastImportAt)}. Methodology version{' '}
        {m.methodologyVersion}.
      </Alert>

      <Section title="KPI definitions" description="Calculated by the backend from imported actual and plan values." flush>
        <SimpleTable caption="KPI definitions" head={['KPI', 'Formula', 'Unit', 'Notes']}>
          {m.kpiDefinitions.map((k) => (
            <TableRow key={k.key}>
              <TableCell className="font-medium">{k.label}</TableCell>
              <TableCell className="font-mono text-xs">{k.formula}</TableCell>
              <TableCell>{unitLabel[k.unit]}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{k.notes ?? '—'}</TableCell>
            </TableRow>
          ))}
        </SimpleTable>
      </Section>

      <Section
        title="Exception rules and thresholds"
        description={`Rule configuration version ${cfg.version}, active since ${formatDateTime(cfg.activatedAt)}. Thresholds are demo assumptions, not universal standards.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/settings">
              <Settings aria-hidden />
              Change thresholds
            </Link>
          </Button>
        }
        flush
      >
        <SimpleTable caption="Exception rules" head={['Rule', 'Condition', 'Severity', 'Enabled']}>
          {cfg.rules.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <p className="font-medium">{r.label}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.key}</p>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-mono text-xs">{r.kpiKey}</span> {ruleConditionText(r)}
              </TableCell>
              <TableCell>
                <SeverityBadge severity={r.severity} />
              </TableCell>
              <TableCell>{r.enabled ? <Badge variant="success">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}</TableCell>
            </TableRow>
          ))}
        </SimpleTable>
      </Section>

      <Section title="Edge cases and missing data" description="Missing values are shown as “—”, never as zero." flush>
        <SimpleTable caption="Edge case handling" head={['Case', 'Handling']}>
          {m.edgeCases.map((e) => (
            <TableRow key={e.case}>
              <TableCell className="font-medium">{e.case}</TableCell>
              <TableCell className="text-sm">{e.handling}</TableCell>
            </TableRow>
          ))}
        </SimpleTable>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Data sources and freshness" flush>
          {m.dataSources.length === 0 ? (
            <Empty>No data has been imported yet.</Empty>
          ) : (
            <SimpleTable caption="Data sources" head={['Source', 'File', 'Source updated', 'Last import']}>
              {m.dataSources.map((d) => (
                <TableRow key={`${d.name}|${d.fileName}`}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="font-mono text-xs">{d.fileName}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(d.updatedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(d.lastImportAt)}</TableCell>
                </TableRow>
              ))}
            </SimpleTable>
          )}
        </Section>

        <Section title="Missing data" description="Fields with no stored value; dependent KPIs are not calculable." flush>
          {m.missingData.length === 0 ? (
            <Empty>No missing values in the stored periods.</Empty>
          ) : (
            <SimpleTable caption="Missing data" head={['Company', 'Field', 'Period']}>
              {m.missingData.map((d, i) => (
                <TableRow key={i}>
                  <TableCell>{d.companyName}</TableCell>
                  <TableCell>{d.field}</TableCell>
                  <TableCell>{formatPeriod(d.period)}</TableCell>
                </TableRow>
              ))}
            </SimpleTable>
          )}
        </Section>
      </div>

      <Section
        title="Validation errors from the last import"
        description="Invalid rows are recorded and excluded from calculations — never silently dropped."
        actions={
          <Button asChild size="sm">
            <Link to="/import">
              <FileUp aria-hidden />
              Import data
            </Link>
          </Button>
        }
        flush
      >
        {m.validationErrors.length === 0 ? (
          <Empty>The last import had no validation errors.</Empty>
        ) : (
          <SimpleTable caption="Validation errors" head={['File', 'Row', 'Field', 'Reason']}>
            {m.validationErrors.map((v, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{v.fileName}</TableCell>
                <TableCell className="tabular">{v.row}</TableCell>
                <TableCell className="font-mono text-xs">{v.field}</TableCell>
                <TableCell>{v.message}</TableCell>
              </TableRow>
            ))}
          </SimpleTable>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="AI status">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Investigation mode:</span>
              <Badge variant={m.aiStatus.mode === 'mock' ? 'inverse' : 'warning'}>{investigationModeLabel[m.aiStatus.mode]}</Badge>
              <span className="text-muted-foreground">Live provider configured:</span>
              <span className="font-medium">{m.aiStatus.liveConfigured ? 'Yes' : 'No'}</span>
            </div>
            <p>{m.aiStatus.note}</p>
          </div>
        </Section>

        <Section title="Nature of the data" description="How each kind of value should be read." flush>
          <ul className="divide-y divide-border text-sm">
            {m.dataNature.map((d) => (
              <li key={d.item} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>{d.item}</span>
                <SourceLabel nature={d.nature} />
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Known limitations">
        <ul className="list-inside list-disc space-y-1 text-sm">
          {m.knownLimitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

export function MethodologyPage() {
  const q = useQuery({ queryKey: queryKeys.methodology, queryFn: () => api.getMethodology() })
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data & Methodology"
        description="How figures are imported, calculated and flagged — formulas, thresholds, sources, missing data and limitations."
        actions={
          <Button asChild>
            <Link to="/import">
              <FileUp aria-hidden />
              Import data
            </Link>
          </Button>
        }
      />
      {q.isPending ? (
        <Loading variant="table" label="Loading methodology…" />
      ) : q.isError ? (
        <ErrorState title="Could not load the methodology" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Content m={q.data} />
      )}
    </div>
  )
}
