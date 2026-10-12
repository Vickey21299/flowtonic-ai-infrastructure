import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'
export type SortDirection = 'asc' | 'desc'
export type SortValue = string | number | null | undefined

export interface Column<T> {
  id: string
  header: ReactNode
  /** Cell content. */
  cell: (row: T) => ReactNode
  /** Enables sorting on this column. Null/undefined always sort last. */
  sortValue?: (row: T) => SortValue
  align?: 'left' | 'right' | 'center'
  /** Hide the column below this breakpoint (it stays in the DOM for wide screens). */
  hideBelow?: Breakpoint
  headerClassName?: string
  className?: string
}

export interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  getRowId: (row: T) => string
  /** Row click / Enter handler; makes rows focusable. */
  onRowClick?: (row: T) => void
  /** Highlights a row (e.g. the one shown in an open drawer). */
  selectedRowId?: string | null
  /** Shows a search box filtering on this text. */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  /** Initial sort. */
  initialSort?: { id: string; direction: SortDirection }
  /** Default 10; the user can switch between `pageSizeOptions`. */
  pageSize?: number
  pageSizeOptions?: number[]
  /** Set false to show all rows. */
  paginate?: boolean
  /** Shown when there are no rows (after search). */
  emptyState?: ReactNode
  /** Accessible table caption (visually hidden). */
  caption: string
  /** Extra controls placed next to the search box. */
  toolbar?: ReactNode
  className?: string
}

const hideClass: Record<Breakpoint, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}
const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Generic table: client-side sort, optional search, pagination, keyboard-activatable rows. */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowClick,
  selectedRowId,
  searchText,
  searchPlaceholder = 'Search…',
  initialSort,
  pageSize: initialPageSize = 10,
  pageSizeOptions = [10, 25],
  paginate = true,
  emptyState,
  caption,
  toolbar,
  className,
}: DataTableProps<T>) {
  const baseId = useId()
  const [sort, setSort] = useState<{ id: string; direction: SortDirection } | null>(initialSort ?? null)
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !searchText) return data
    return data.filter((row) => searchText(row).toLowerCase().includes(q))
  }, [data, query, searchText])

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id)
    if (!sort || !col?.sortValue) return filtered
    const get = col.sortValue
    const dir = sort.direction === 'asc' ? 1 : -1
    return [...filtered].sort((ra, rb) => {
      const a = get(ra)
      const b = get(rb)
      const aMissing = a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a))
      const bMissing = b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b))
      if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1
      return compare(a, b) * dir
    })
  }, [filtered, sort, columns])

  const pageCount = paginate ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const currentPage = Math.min(page, pageCount - 1)
  const rows = paginate ? sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize) : sorted
  const firstIndex = sorted.length === 0 ? 0 : currentPage * pageSize + 1
  const lastIndex = paginate ? Math.min(sorted.length, (currentPage + 1) * pageSize) : sorted.length

  const toggleSort = (id: string) => {
    setSort((s) => (s?.id === id ? { id, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { id, direction: 'asc' }))
    setPage(0)
  }

  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    // Only when the row itself has focus, so links/buttons inside cells keep their own behaviour.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick?.(row)
    }
  }

  const showToolbar = Boolean(searchText || toolbar)

  return (
    <div className={cn('space-y-3', className)}>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {searchText && (
            <div className="relative w-full sm:w-64">
              <label htmlFor={`${baseId}-search`} className="sr-only">
                Search {caption}
              </label>
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id={`${baseId}-search`}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{toolbar}</div>}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((col) => {
                const active = sort?.id === col.id
                const ariaSort = col.sortValue
                  ? active
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined
                const SortIcon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <TableHead
                    key={col.id}
                    aria-sort={ariaSort}
                    className={cn(
                      alignClass[col.align ?? 'left'],
                      col.hideBelow && hideClass[col.hideBelow],
                      col.headerClassName,
                    )}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={cn(
                          '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground',
                          active && 'text-foreground',
                          col.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {col.header}
                        <SortIcon className={cn('h-3 w-3', !active && 'opacity-40')} aria-hidden />
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-muted-foreground">
                  {emptyState ?? (query ? 'No rows match your search.' : 'No records.')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const id = getRowId(row)
                const selected = selectedRowId === id
                return (
                  <TableRow
                    key={id}
                    aria-selected={selectedRowId !== undefined ? selected : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => onRowKeyDown(e, row) : undefined}
                    className={cn(
                      onRowClick &&
                        'cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-inset focus-visible:ring-offset-0',
                      selected && 'bg-muted/70',
                    )}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          alignClass[col.align ?? 'left'],
                          col.hideBelow && hideClass[col.hideBelow],
                          col.className,
                        )}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {paginate && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p aria-live="polite" className="tabular">
            Showing {firstIndex}–{lastIndex} of {sorted.length}
            {filtered.length !== data.length && ` (filtered from ${data.length})`}
          </p>
          <div className="flex items-center gap-2">
            {sorted.length > Math.min(...pageSizeOptions) && (
              <div className="flex items-center gap-1.5">
                <label htmlFor={`${baseId}-size`}>Rows per page</label>
                <NativeSelect
                  id={`${baseId}-size`}
                  value={String(pageSize)}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(0)
                  }}
                  className="h-8 w-[4.5rem] text-xs"
                >
                  {pageSizeOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <span className="px-1 tabular">
                  Page {currentPage + 1} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="Next page"
                >
                  <ChevronRight aria-hidden />
                </Button>
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
