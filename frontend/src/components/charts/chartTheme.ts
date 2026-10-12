/** Chart colours resolved from the CSS tokens in src/index.css (SVG attributes accept var()). */
export const chartColors = {
  actual: 'hsl(var(--accent))',
  plan: 'hsl(var(--muted-foreground) / 0.45)',
  grid: 'hsl(var(--border))',
  axis: 'hsl(var(--muted-foreground))',
  cursor: 'hsl(var(--muted) / 0.8)',
  danger: 'hsl(var(--status-danger))',
  warning: 'hsl(var(--status-warning))',
  warningLight: 'hsl(var(--status-warning) / 0.55)',
  success: 'hsl(var(--status-success))',
  neutral: 'hsl(var(--muted-foreground) / 0.6)',
} as const

export const axisTick = { fontSize: 11, fill: chartColors.axis }
