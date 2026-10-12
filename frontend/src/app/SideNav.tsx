import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isNavItemActive, navItems } from './nav'

interface SideNavProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void
  /** Mobile variant: always expanded, no collapse button. */
  mobile?: boolean
}

export function SideNav({ collapsed, onToggleCollapsed, onNavigate, mobile = false }: SideNavProps) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  // Keep the selected reporting period when moving between screens; other filters are per-screen.
  const period = params.get('period')
  const periodQuery = period ? `?period=${encodeURIComponent(period)}` : ''
  const isCollapsed = collapsed && !mobile

  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <ul className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map((item) => {
          const active = isNavItemActive(item, pathname)
          const Icon = item.icon
          return (
            <li key={item.to}>
              <Link
                to={`${item.to}${periodQuery}`}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isCollapsed && 'justify-center px-0',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className={cn(isCollapsed && 'sr-only')}>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>

      {!mobile && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="flex w-full items-center justify-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      )}
    </nav>
  )
}
