import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ActualVsPlanPoint } from '@/api/types'
import { formatMoney, formatNumber, type MoneyUnit } from '@/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ChartFrame, LegendItem } from './ChartFrame'
import { axisTick, chartColors } from './chartTheme'

interface ActualVsPlanChartProps {
  data: ActualVsPlanPoint[]
  /** e.g. "Revenue actual vs plan by company, Sep 2026". Used as the accessible name and table caption. */
  label: string
  currency?: string
  moneyUnit?: MoneyUnit
  height?: number
  /** Called when a company's bars are clicked. */
  onSelectCompany?: (companyId: string) => void
  /** Header of the category column in the table view (default "Company"; e.g. "Period" for a trend). */
  categoryHeader?: string
}

interface TooltipPayload {
  payload?: ActualVsPlanPoint
}


/** Grouped bars, actual vs plan per company. Missing values draw no bar and read "—" in tooltip and table. */
export function ActualVsPlanChart({
  data,
  label,
  currency = 'USD',
  moneyUnit = 'millions',
  height = 260,
  onSelectCompany,
  categoryHeader = 'Company',
}: ActualVsPlanChartProps) {
  const money = (v: number | null) => formatMoney(v, { currency, unit: moneyUnit })
  const hasNegative = data.some((d) => (d.actual ?? 0) < 0 || (d.plan ?? 0) < 0)

  const table = (
    <Table>
      <caption className="sr-only">{label}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>{categoryHeader}</TableHead>
          <TableHead className="text-right">Actual</TableHead>
          <TableHead className="text-right">Plan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.companyId}>
            <TableCell>{d.companyName}</TableCell>
            <TableCell className="text-right">{money(d.actual)}</TableCell>
            <TableCell className="text-right">{money(d.plan)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const legend = (
    <div className="flex flex-wrap gap-3">
      <LegendItem color={chartColors.actual} label="Actual" />
      <LegendItem color={chartColors.plan} label="Plan" />
    </div>
  )

  return (
    <ChartFrame label={label} table={table} legend={legend} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="24%"
          onClick={
            onSelectCompany
              ? (state) => {
                  const p = (state?.activePayload?.[0] as TooltipPayload | undefined)?.payload
                  if (p) onSelectCompany(p.companyId)
                }
              : undefined
          }
          style={onSelectCompany ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid vertical={false} stroke={chartColors.grid} />
          <XAxis
            dataKey="companyName"
            tick={false}
            height={8}
            tickLine={false}
            axisLine={{ stroke: chartColors.grid }}
            interval={0}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => formatNumber(v, { dp: v % 1 === 0 ? 0 : 1 })}
          />
          {hasNegative && <ReferenceLine y={0} stroke={chartColors.axis} />}
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = (payload?.[0] as TooltipPayload | undefined)?.payload
              if (!active || !p) return null
              return (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium text-foreground">{p.companyName}</p>
                  <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2 w-2 rounded-sm" style={{ background: chartColors.actual }} aria-hidden />
                      Actual
                    </dt>
                    <dd className="text-right text-foreground">{money(p.actual)}</dd>
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2 w-2 rounded-sm" style={{ background: chartColors.plan }} aria-hidden />
                      Plan
                    </dt>
                    <dd className="text-right text-foreground">{money(p.plan)}</dd>
                  </dl>
                </div>
              )
            }}
          />
          <Bar dataKey="actual" name="Actual" fill={chartColors.actual} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="plan" name="Plan" fill={chartColors.plan} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
