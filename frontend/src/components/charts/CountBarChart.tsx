import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCount } from '@/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ChartFrame } from './ChartFrame'
import { axisTick, chartColors } from './chartTheme'

export interface CountDatum<K extends string> {
  key: K
  label: string
  count: number
  color: string
}

interface CountBarChartProps<K extends string> {
  data: CountDatum<K>[]
  label: string
  categoryHeader: string
  height?: number
  onSelect?: (key: K) => void
}

/** Horizontal count bars with category labels on the axis (identity never by colour alone). */
export function CountBarChart<K extends string>({
  data,
  label,
  categoryHeader,
  height,
  onSelect,
}: CountBarChartProps<K>) {
  const h = height ?? Math.max(120, data.length * 40 + 16)

  const table = (
    <Table>
      <caption className="sr-only">{label}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>{categoryHeader}</TableHead>
          <TableHead className="text-right">Count</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.key}>
            <TableCell>{d.label}</TableCell>
            <TableCell className="text-right">{formatCount(d.count)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  return (
    <ChartFrame label={label} table={table} height={h}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 0 }} barCategoryGap="28%">
          <XAxis type="number" hide allowDecimals={false} domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: chartColors.grid }}
            width={112}
          />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as CountDatum<K> | undefined
              if (!active || !p) return null
              return (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
                    <span className="text-muted-foreground">{p.label}</span>
                    <span className="ml-3 font-medium text-foreground tabular">{formatCount(p.count)}</span>
                  </span>
                </div>
              )
            }}
          />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            isAnimationActive={false}
            onClick={onSelect ? (d: { payload?: CountDatum<K> }) => d.payload && onSelect(d.payload.key) : undefined}
            style={onSelect ? { cursor: 'pointer' } : undefined}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
            <LabelList dataKey="count" position="right" fontSize={11} fill="hsl(var(--foreground))" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
