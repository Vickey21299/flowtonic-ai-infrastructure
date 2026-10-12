import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Menu, UserCircle2 } from 'lucide-react'
import { api } from '@/api'
import { queryKeys } from '@/lib/queryKeys'

interface HeaderProps {
  onOpenMobileNav: () => void
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function Header({ onOpenMobileNav }: HeaderProps) {
  const { data: ws } = useQuery({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })
  const [params, setParams] = useSearchParams()
  const period = params.get('period') ?? ws?.currentPeriod ?? ''

  const onPeriodChange = (value: string) => {
    const next = new URLSearchParams(params)
    if (value === ws?.currentPeriod) next.delete('period')
    else next.set('period', value)
    setParams(next)
  }

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      <Link to="/" className="text-base font-semibold tracking-tight text-foreground">
        Flownetic
      </Link>

      <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
      <span className="hidden truncate text-sm text-muted-foreground sm:block">
        {ws ? ws.name : 'Loading workspace…'}
      </span>

      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="hidden text-muted-foreground md:inline">Period</span>
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            disabled={!ws}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
            aria-label="Reporting period"
          >
            {ws?.periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {ws && (
          <p
            className="hidden text-xs text-muted-foreground xl:block"
            title={`Source: ${ws.sourceName}`}
          >
            Latest data: {ws.periods.find((p) => p.key === ws.currentPeriod)?.label} · imported{' '}
            {dateTimeFmt.format(new Date(ws.lastImportAt))}
          </p>
        )}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-muted">
            <UserCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="hidden sm:inline">{ws?.demoUser.name ?? 'Demo user'}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-52 rounded-md border border-border bg-surface p-1 text-sm shadow-md"
            >
              <div className="px-2 py-1.5">
                <p className="font-medium">{ws?.demoUser.name}</p>
                <p className="text-xs text-muted-foreground">{ws?.demoUser.role} · demo user</p>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item asChild>
                <Link
                  to="/settings"
                  className="block cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-muted"
                >
                  Settings & demo reset
                </Link>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  )
}
