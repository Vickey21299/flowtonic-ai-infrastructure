import { useId, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'

export interface FilterOption {
  value: string
  label: string
}

export interface FilterDef {
  id: string
  label: string
  options: FilterOption[]
  /** Current value; `undefined` or "" means "All". */
  value: string | undefined
  /** Label of the empty option (default "All"). */
  allLabel?: string
}

interface FilterBarProps {
  filters: FilterDef[]
  /** `value` is `undefined` when "All" is chosen. */
  onFilterChange: (id: string, value: string | undefined) => void
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    /** Accessible label (default "Search"). */
    label?: string
  }
  /** Shown when any filter or the search is active. */
  onClear?: () => void
  /** Extra controls appended to the row. */
  children?: ReactNode
  className?: string
}

/** Controlled row of labelled select filters plus an optional search box and "Clear filters". */
export function FilterBar({ filters, onFilterChange, search, onClear, children, className }: FilterBarProps) {
  const baseId = useId()
  const active = filters.some((f) => f.value) || Boolean(search?.value)

  return (
    <div role="group" aria-label="Filters" className={cn('flex flex-wrap items-end gap-3', className)}>
      {search && (
        <div className="flex w-full flex-col gap-1 sm:w-64">
          <label htmlFor={`${baseId}-search`} className="text-xs font-medium text-muted-foreground">
            {search.label ?? 'Search'}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={`${baseId}-search`}
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'Search…'}
              className="pl-8"
            />
          </div>
        </div>
      )}

      {filters.map((f) => {
        const id = `${baseId}-${f.id}`
        return (
          <div key={f.id} className="flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none">
            <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
              {f.label}
            </label>
            <NativeSelect
              id={id}
              value={f.value ?? ''}
              onChange={(e) => onFilterChange(f.id, e.target.value === '' ? undefined : e.target.value)}
              className={cn(f.value && 'border-foreground/40 font-medium')}
            >
              <option value="">{f.allLabel ?? 'All'}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )
      })}

      {children}

      {onClear && active && (
        <Button variant="ghost" size="default" onClick={onClear} className="text-muted-foreground">
          <X aria-hidden />
          Clear filters
        </Button>
      )}
    </div>
  )
}
