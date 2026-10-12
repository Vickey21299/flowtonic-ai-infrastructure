import {
  AlertTriangle,
  Building2,
  Database,
  FileSearch,
  LayoutDashboard,
  ListChecks,
  Settings,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Extra path prefixes that should also highlight this item. */
  alsoActiveFor?: string[]
}

/** The 8 primary navigation items, in Spec §2 order. */
export const navItems: NavItem[] = [
  { label: 'Overview', to: '/', icon: LayoutDashboard },
  { label: 'Portfolio Companies', to: '/companies', icon: Building2 },
  { label: 'Exceptions', to: '/exceptions', icon: AlertTriangle },
  { label: 'Investigations', to: '/investigations', icon: FileSearch },
  { label: 'Actions', to: '/actions', icon: ListChecks },
  { label: 'Impact Tracking', to: '/impact', icon: TrendingUp },
  { label: 'Data & Methodology', to: '/methodology', icon: Database, alsoActiveFor: ['/import'] },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  const prefixes = [item.to, ...(item.alsoActiveFor ?? [])]
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
