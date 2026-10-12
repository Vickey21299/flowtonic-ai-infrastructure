import { useId, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download, FileUp, FlaskConical } from 'lucide-react'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { ImportIssue, ImportJob, ImportRow, SchemaField, SchemaFieldInfo } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { Section } from '@/components/Section'
import { ErrorState } from '@/components/states/ErrorState'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Documented schema shown before a file is uploaded (after upload, `job.schema` is used). Spec §6. */
const STATIC_SCHEMA: Pick<SchemaFieldInfo, 'field' | 'required'>[] = [
  { field: 'company_id', required: true },
  { field: 'company_name', required: true },
  { field: 'sector', required: false },
  { field: 'reporting_period', required: true },
  { field: 'revenue_actual', required: true },
  { field: 'revenue_plan', required: true },
  { field: 'ebitda_actual', required: true },
  { field: 'ebitda_plan', required: true },
  { field: 'source_name', required: false },
  { field: 'source_updated_at', required: false },
]

type Classification = ImportRow['classification']
const CLASSES: Classification[] = ['new', 'changed', 'unchanged', 'invalid']
const classLook: Record<Classification, { label: string; variant: BadgeVariant; help: string }> = {
  new: { label: 'New', variant: 'accent', help: 'Not stored yet; will be imported.' },
  changed: { label: 'Changed', variant: 'warning', help: 'Differs from stored values; will supersede them (history kept).' },
  unchanged: { label: 'Unchanged', variant: 'outline', help: 'Identical to stored values; nothing to change.' },
  invalid: { label: 'Invalid', variant: 'danger', help: 'Recorded as invalid and excluded from calculations.' },
}

function ClassBadge({ c }: { c: Classification }) {
  return <Badge variant={classLook[c].variant}>{classLook[c].label}</Badge>
}

function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">{children}</div>
}

// ---------- 1. Upload ----------

export function UploadStep({ onUploaded }: { onUploaded: (job: ImportJob) => void }) {
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: (file: { name: string; text: string }) => api.uploadImport(file),
    onSuccess: onUploaded,
  })
  const sample = useMutation({
    mutationFn: async () => {
      const s = await api.getSampleCsv()
      return api.uploadImport({ name: s.fileName, text: s.text })
    },
    onSuccess: onUploaded,
  })
  const download = useMutation({
    mutationFn: () => api.getSampleCsv(),
    onSuccess: (s) => {
      const url = URL.createObjectURL(new Blob([s.text], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = s.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  })

  const handleFile = async (file: File | undefined) => {
    setFileError(null)
    upload.reset()
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError(`“${file.name}” is not a .csv file. Export the data as CSV and try again.`)
      return
    }
    const text = await file.text()
    if (!text.trim()) {
      setFileError(`“${file.name}” is empty.`)
      return
    }
    upload.mutate({ name: file.name, text })
  }

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragging(false)
    void handleFile(e.dataTransfer.files[0])
  }

  const busy = upload.isPending || sample.isPending

  return (
    <div className="space-y-6">
      <div>
        <input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          className="peer sr-only"
          disabled={busy}
          onChange={(e) => {
            void handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
            dragging ? 'border-foreground bg-muted' : 'border-border bg-surface hover:bg-muted/40',
          )}
        >
          <FileUp className="h-8 w-8 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">{busy ? 'Reading file…' : 'Drop a CSV file here, or click to choose one'}</span>
          <span className="text-xs text-muted-foreground">One row per company and month. Values in USD millions.</span>
        </label>
      </div>

      {fileError && <Alert variant="danger" title="File not accepted">{fileError}</Alert>}
      {upload.isError && <ErrorState compact title="Could not read the file" error={upload.error} />}
      {sample.isError && <ErrorState compact title="Could not load the sample" error={sample.error} />}
      {download.isError && <ErrorState compact title="Could not download the sample" error={download.error} />}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => sample.mutate()}>
          <FlaskConical aria-hidden />
          {sample.isPending ? 'Loading sample…' : 'Use sample CSV'}
        </Button>
        <Button variant="ghost" disabled={download.isPending} onClick={() => download.mutate()}>
          <Download aria-hidden />
          Download sample CSV
        </Button>
      </div>

      <Section title="Expected columns" description="Column names can differ — you map them in the next step." flush>
        <Table>
          <caption className="sr-only">Import schema</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Required</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STATIC_SCHEMA.map((f) => (
              <TableRow key={f.field}>
                <TableCell className="font-mono text-xs">{f.field}</TableCell>
                <TableCell>{f.required ? 'Required' : 'Optional'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  )
}

// ---------- 2. Map ----------

function FileErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <Alert variant="danger" title={`${errors.length} blocking ${errors.length === 1 ? 'problem' : 'problems'} — the import cannot be confirmed`}>
      <ul className="list-inside list-disc">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </Alert>
  )
}

export function MapStep({ job, onValidated }: { job: ImportJob; onValidated: (j: ImportJob) => void }) {
  const [mapping, setMapping] = useState<ImportJob['mapping']>(() => ({ ...job.mapping }))
  const save = useMutation({
    mutationFn: () => api.setImportMapping(job.id, mapping),
    onSuccess: onValidated,
  })

  const used = new Set(Object.values(mapping).filter((c): c is string => Boolean(c)))
  const ignored = job.detectedColumns.filter((c) => !used.has(c))
  const missingRequired = job.schema.filter((f) => f.required && !mapping[f.field])

  return (
    <div className="space-y-4">
      <FileErrors errors={job.fileErrors} />

      <Section title="Map columns" description={`${job.detectedColumns.length} columns detected. Matching names were mapped automatically.`} flush>
        <Table>
          <caption className="sr-only">Column mapping</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
              <TableHead>CSV column</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {job.schema.map((f) => {
              const id = `map-${f.field}`
              return (
                <TableRow key={f.field}>
                  <TableCell>
                    <Label htmlFor={id} className="font-medium">
                      {f.label}
                      {f.required && <span className="text-status-danger"> *</span>}
                      <span className="sr-only">{f.required ? ' (required)' : ' (optional)'}</span>
                    </Label>
                    <p className="font-mono text-xs text-muted-foreground">{f.field}</p>
                  </TableCell>
                  <TableCell className="hidden max-w-xs text-xs text-muted-foreground md:table-cell">{f.description}</TableCell>
                  <TableCell>
                    <NativeSelect
                      id={id}
                      value={mapping[f.field] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [f.field as SchemaField]: e.target.value || null })}
                      aria-invalid={f.required && !mapping[f.field]}
                      className="min-w-[10rem]"
                    >
                      <option value="">{f.required ? '— choose a column —' : '— not in file —'}</option>
                      {job.detectedColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Section>

      <p className="text-xs text-muted-foreground">
        <span className="text-status-danger">*</span> required.{' '}
        {ignored.length > 0 ? (
          <>
            Columns that will be ignored: <span className="font-mono">{ignored.join(', ')}</span>.
          </>
        ) : (
          'Every column in the file is mapped.'
        )}
      </p>
      {missingRequired.length > 0 && (
        <Alert variant="warning">
          Not mapped yet: {missingRequired.map((f) => f.label).join(', ')}. Validation will report this as a blocking problem.
        </Alert>
      )}
      {save.isError && <ErrorState compact title="Could not apply the mapping" error={save.error} />}

      <StepActions>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Validating…' : 'Validate'}
        </Button>
      </StepActions>
    </div>
  )
}

// ---------- 3. Preview ----------

const PREVIEW_FIELDS: { field: string; label: string; align?: 'right' }[] = [
  { field: 'company_id', label: 'Company ID' },
  { field: 'reporting_period', label: 'Period' },
  { field: 'revenue_actual', label: 'Rev. actual', align: 'right' },
  { field: 'revenue_plan', label: 'Rev. plan', align: 'right' },
  { field: 'ebitda_actual', label: 'EBITDA actual', align: 'right' },
  { field: 'ebitda_plan', label: 'EBITDA plan', align: 'right' },
]

function countBy(rows: ImportRow[]): Record<Classification, number> {
  const c: Record<Classification, number> = { new: 0, changed: 0, unchanged: 0, invalid: 0 }
  for (const r of rows) c[r.classification] += 1
  return c
}

function IssueList({ rows }: { rows: ImportRow[] }) {
  const issues = rows.flatMap((r) => r.issues.map((i) => ({ row: r.rowNumber, ...i })))
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">No errors or warnings.</p>
  return (
    <Table>
      <caption className="sr-only">Validation errors and warnings</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Row</TableHead>
          <TableHead>Field</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Explanation</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((i, k) => (
          <TableRow key={k}>
            <TableCell className="tabular">{i.row}</TableCell>
            <TableCell className="font-mono text-xs">{i.field}</TableCell>
            <TableCell>
              <Badge variant={i.severity === 'error' ? 'danger' : 'warning'}>{i.severity === 'error' ? 'Error' : 'Warning'}</Badge>
            </TableCell>
            <TableCell>{i.message}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function issueSummary(issues: ImportIssue[]) {
  if (issues.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <ul className="space-y-0.5 text-xs">
      {issues.map((i, k) => (
        <li key={k} className={i.severity === 'error' ? 'text-status-danger' : 'text-status-warning'}>
          <span className="font-mono">{i.field}</span>: {i.message}
        </li>
      ))}
    </ul>
  )
}

export function PreviewStep({ job, onBack, onNext }: { job: ImportJob; onBack: () => void; onNext: () => void }) {
  const [onlyIssues, setOnlyIssues] = useState(false)
  const counts = useMemo(() => countBy(job.rows), [job.rows])
  const shown = onlyIssues ? job.rows.filter((r) => r.issues.length > 0 || r.classification === 'invalid') : job.rows

  const columns: Column<ImportRow>[] = [
    { id: 'row', header: 'Row', cell: (r) => <span className="tabular">{r.rowNumber}</span>, sortValue: (r) => r.rowNumber },
    { id: 'class', header: 'Result', cell: (r) => <ClassBadge c={r.classification} />, sortValue: (r) => CLASSES.indexOf(r.classification) },
    ...PREVIEW_FIELDS.map<Column<ImportRow>>((f) => ({
      id: f.field,
      header: f.label,
      align: f.align,
      cell: (r) => {
        const v = r.values[f.field]
        const bad = r.issues.some((i) => i.field === f.field && i.severity === 'error')
        return v === undefined || v === '' ? (
          <span className={cn('text-muted-foreground', bad && 'text-status-danger')}>(empty)</span>
        ) : (
          <span className={cn('font-mono text-xs', bad && 'font-semibold text-status-danger')}>{v}</span>
        )
      },
      hideBelow: f.field === 'company_id' || f.field === 'ebitda_actual' ? undefined : 'md',
    })),
    { id: 'issues', header: 'Issues', cell: (r) => issueSummary(r.issues), className: 'min-w-[14rem]' },
  ]

  return (
    <div className="space-y-4">
      <FileErrors errors={job.fileErrors} />

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Rows by result">
        {CLASSES.map((c) => (
          <li key={c} className="rounded-lg border border-border bg-surface p-3">
            <ClassBadge c={c} />
            <p className="mt-1 text-xl font-semibold tabular">{formatCount(counts[c])}</p>
            <p className="text-xs text-muted-foreground">{classLook[c].help}</p>
          </li>
        ))}
      </ul>

      {counts.invalid > 0 && (
        <Alert variant="warning" title={`${counts.invalid} invalid ${counts.invalid === 1 ? 'row' : 'rows'}`}>
          Invalid rows are not discarded silently: they are recorded with their errors and excluded from KPI calculations.
        </Alert>
      )}

      <Section title="Errors and warnings" flush>
        <IssueList rows={job.rows} />
      </Section>

      <Section
        title="Rows"
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="only-issues" checked={onlyIssues} onCheckedChange={(v) => setOnlyIssues(v === true)} />
            <Label htmlFor="only-issues">Only rows with issues</Label>
          </div>
        }
        contentClassName="p-3"
      >
        <DataTable
          data={shown}
          columns={columns}
          getRowId={(r) => String(r.rowNumber)}
          caption="Parsed rows"
          initialSort={{ id: 'row', direction: 'asc' }}
          pageSize={25}
          pageSizeOptions={[25, 100]}
          emptyState={onlyIssues ? 'No rows have issues.' : 'The file has no data rows.'}
        />
      </Section>

      <StepActions>
        <Button variant="ghost" onClick={onBack}>
          Back to mapping
        </Button>
        <Button onClick={onNext} disabled={job.fileErrors.length > 0} title={job.fileErrors.length ? 'Fix the blocking problems first.' : undefined}>
          Continue to confirm
        </Button>
      </StepActions>
    </div>
  )
}

// ---------- 4. Confirm ----------

export function ConfirmStep({
  job,
  onBack,
  onCommitted,
}: {
  job: ImportJob
  onBack: () => void
  onCommitted: (j: ImportJob) => void | Promise<void>
}) {
  const counts = useMemo(() => countBy(job.rows), [job.rows])
  const [ack, setAck] = useState(false)
  const confirm = useMutation({
    mutationFn: () => api.confirmImport(job.id, { acknowledgeInvalidRows: ack }),
    onSuccess: (j) => onCommitted(j),
  })
  const needsAck = counts.invalid > 0
  const apiErr = isApiError(confirm.error) ? confirm.error : null
  const ackErr = apiErr?.fieldErrors.find((f) => /acknowledge/i.test(f.field))?.message

  return (
    <div className="space-y-4">
      <FileErrors errors={job.fileErrors} />
      <Section title="What will happen">
        <ul className="list-inside list-disc space-y-1 text-sm">
          <li>
            <strong className="tabular">{counts.new}</strong> new {counts.new === 1 ? 'row' : 'rows'} will be imported.
          </li>
          <li>
            <strong className="tabular">{counts.changed}</strong> changed {counts.changed === 1 ? 'row' : 'rows'} will supersede stored
            values (previous values stay in the data history).
          </li>
          <li>
            <strong className="tabular">{counts.unchanged}</strong> unchanged {counts.unchanged === 1 ? 'row' : 'rows'} will be skipped.
          </li>
          <li>
            <strong className="tabular">{counts.invalid}</strong> invalid {counts.invalid === 1 ? 'row' : 'rows'} will be recorded as
            invalid and excluded from calculations.
          </li>
          <li>KPIs and exceptions are recalculated for the affected companies and periods.</li>
        </ul>
      </Section>

      {needsAck && (
        <div className="space-y-1 rounded-md border border-status-warning/40 bg-status-warning-bg p-3">
          <div className="flex items-start gap-2">
            <Checkbox id="ack-invalid" checked={ack} onCheckedChange={(v) => setAck(v === true)} aria-describedby={ackErr ? 'ack-err' : undefined} className="mt-0.5" />
            <Label htmlFor="ack-invalid" className="text-sm font-normal leading-snug">
              I understand {counts.invalid} invalid {counts.invalid === 1 ? 'row' : 'rows'} will be recorded as invalid and excluded from
              calculations. (Required)
            </Label>
          </div>
          {ackErr && (
            <p id="ack-err" className="text-xs text-status-danger">
              {ackErr}
            </p>
          )}
        </div>
      )}

      {confirm.isError && !ackErr && <ErrorState compact title="The import was not confirmed — no data was changed" error={confirm.error} />}

      <StepActions>
        <Button variant="ghost" onClick={onBack}>
          Back to preview
        </Button>
        <Button disabled={confirm.isPending || (needsAck && !ack) || job.fileErrors.length > 0} onClick={() => confirm.mutate()}>
          {confirm.isPending ? 'Importing…' : 'Confirm import'}
        </Button>
      </StepActions>
    </div>
  )
}

// ---------- 5. Summary ----------

const SUMMARY_ROWS: { key: keyof NonNullable<ImportJob['summary']>; label: string }[] = [
  { key: 'rowsRead', label: 'Rows read' },
  { key: 'imported', label: 'Rows imported' },
  { key: 'unchanged', label: 'Rows unchanged' },
  { key: 'superseded', label: 'Values superseded' },
  { key: 'invalid', label: 'Invalid rows recorded' },
  { key: 'companiesCreated', label: 'Companies created' },
  { key: 'kpisRecalculated', label: 'KPIs recalculated' },
  { key: 'exceptionsCreated', label: 'Exceptions created' },
  { key: 'exceptionsUpdated', label: 'Exceptions updated' },
  { key: 'exceptionsConditionCleared', label: 'Exceptions with condition cleared (review)' },
]

export function SummaryStep({ job, onNew }: { job: ImportJob; onNew: () => void }) {
  const s = job.summary
  const nothingChanged = s !== null && s.imported === 0 && s.superseded === 0 && s.unchanged > 0
  return (
    <div className="space-y-4">
      <Alert variant="success" title="Import complete" />
      {nothingChanged && (
        <Alert variant="warning" title="Nothing changed">
          Every valid row was identical to the stored data, so no values, KPIs or exceptions were changed.
        </Alert>
      )}
      {s ? (
        <Section title="Import summary" flush>
          <dl className="divide-y divide-border text-sm">
            {SUMMARY_ROWS.map((r) => (
              <div key={r.key} className="flex justify-between gap-4 px-4 py-2">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-semibold tabular">{formatCount(s[r.key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">No summary was returned for this import.</p>
      )}
      <StepActions>
        <Button variant="ghost" onClick={onNew}>
          Import another file
        </Button>
        <Button asChild variant="outline">
          <Link to="/exceptions">View exceptions</Link>
        </Button>
        <Button asChild>
          <Link to="/">Go to Overview</Link>
        </Button>
      </StepActions>
    </div>
  )
}
