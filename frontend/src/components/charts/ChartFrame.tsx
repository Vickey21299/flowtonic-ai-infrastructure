import { useState, type ReactNode } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'

interface ChartFrameProps {
  /** Accessible description of the chart (role="img" aria-label). */
  label: string
  /** Data table equivalent of the chart; shown via the "Table" toggle. */
  table: ReactNode
  /** Optional legend shown above the plot. */
  legend?: ReactNode
  height: number
  children: ReactNode
  className?: string
}

/** Wraps a chart with a chart/table toggle so the data is always available as text. */
export function ChartFrame({ label, table, legend, height, children, className }: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false)
  return (
    <figure className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">{legend}</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
          className="ml-auto text-muted-foreground"
        >
          {showTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
          {showTable ? 'Chart' : 'Table'}
          <span className="sr-only"> view of {label}</span>
        </Button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto">{table}</div>
      ) : (
        <div role="img" aria-label={label} style={{ height }}>
          {children}
        </div>
      )}
    </figure>
  )
}

export function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn('inline-block h-2.5 w-2.5 rounded-sm', dashed && 'border border-dashed')}
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </span>
  )
}
