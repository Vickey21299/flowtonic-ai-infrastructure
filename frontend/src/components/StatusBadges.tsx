import type { LucideIcon } from 'lucide-react'
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  Eye,
  HelpCircle,
  Info,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import type {
  ActionStatus,
  CompanyStatus,
  ExceptionStatus,
  ImpactVerificationStatus,
  Priority,
  ReviewStatus,
  Severity,
} from '@/api/types'
import {
  actionStatusLabel,
  companyStatusLabel,
  exceptionStatusLabel,
  priorityLabel,
  reviewStatusLabel,
  severityLabel,
  verificationLabel,
} from '@/lib/format'
import { Badge, type BadgeVariant } from './ui/badge'

// Every badge pairs colour with an icon and a text label, so status is never conveyed by colour alone.

interface Look {
  variant: BadgeVariant
  icon?: LucideIcon
}

function StatusChip({ look, label, className, title }: { look: Look; label: string; className?: string; title?: string }) {
  const Icon = look.icon
  return (
    <Badge variant={look.variant} className={className} title={title}>
      {Icon && <Icon aria-hidden />}
      {label}
    </Badge>
  )
}

const companyStatusLook: Record<CompanyStatus, Look> = {
  on_track: { variant: 'success', icon: CheckCircle2 },
  warning: { variant: 'warning', icon: AlertTriangle },
  exception: { variant: 'danger', icon: AlertOctagon },
  insufficient_data: { variant: 'outline', icon: HelpCircle },
}

export function StatusBadge({ status, className }: { status: CompanyStatus; className?: string }) {
  return <StatusChip look={companyStatusLook[status]} label={companyStatusLabel[status]} className={className} />
}

const severityLook: Record<Severity, Look> = {
  high: { variant: 'danger', icon: AlertOctagon },
  medium: { variant: 'warning', icon: AlertTriangle },
  warning: { variant: 'outline', icon: Info },
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <StatusChip
      look={severityLook[severity]}
      label={severityLabel[severity]}
      className={className}
      title={`Severity: ${severityLabel[severity]}`}
    />
  )
}

const exceptionStatusLook: Record<ExceptionStatus, Look> = {
  open: { variant: 'warning', icon: CircleDot },
  acknowledged: { variant: 'neutral', icon: Eye },
  in_review: { variant: 'accent', icon: Clock },
  resolved: { variant: 'success', icon: CheckCircle2 },
}

interface ExceptionStatusBadgeProps {
  status: ExceptionStatus
  /** Pass `ExceptionSummary.conditionActive`; when false on an unresolved exception, adds a "Condition cleared — review" badge. */
  conditionActive?: boolean
  className?: string
}

export function ExceptionStatusBadge({ status, conditionActive = true, className }: ExceptionStatusBadgeProps) {
  const chip = (
    <StatusChip look={exceptionStatusLook[status]} label={exceptionStatusLabel[status]} className={className} />
  )
  if (conditionActive || status === 'resolved') return chip
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {chip}
      <Badge variant="outline">Condition cleared — review</Badge>
    </span>
  )
}

const actionStatusLook: Record<ActionStatus, Look> = {
  proposed: { variant: 'outline', icon: CircleDashed },
  approved: { variant: 'neutral', icon: CircleDot },
  in_progress: { variant: 'accent', icon: Clock },
  completed: { variant: 'neutral', icon: CheckCircle2 },
  outcome_verification: { variant: 'warning', icon: Eye },
  verified: { variant: 'success', icon: CheckCircle2 },
  reopened: { variant: 'warning', icon: RotateCcw },
  cancelled: { variant: 'outline', icon: XCircle },
}

interface ActionStatusBadgeProps {
  status: ActionStatus
  /** Adds a red "Overdue" badge next to the status. */
  overdue?: boolean
  className?: string
}

export function ActionStatusBadge({ status, overdue, className }: ActionStatusBadgeProps) {
  const chip = <StatusChip look={actionStatusLook[status]} label={actionStatusLabel[status]} className={className} />
  if (!overdue) return chip
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {chip}
      <OverdueBadge />
    </span>
  )
}

export function OverdueBadge({ className }: { className?: string }) {
  return <StatusChip look={{ variant: 'danger', icon: Clock }} label="Overdue" className={className} />
}

const priorityLook: Record<Priority, Look> = {
  high: { variant: 'danger' },
  medium: { variant: 'warning' },
  low: { variant: 'outline' },
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <StatusChip
      look={priorityLook[priority]}
      label={priorityLabel[priority]}
      className={className}
      title={`Priority: ${priorityLabel[priority]}`}
    />
  )
}

const verificationLook: Record<ImpactVerificationStatus | 'none', Look> = {
  not_yet_measurable: { variant: 'outline', icon: Clock },
  unverified: { variant: 'warning', icon: HelpCircle },
  verified: { variant: 'success', icon: CheckCircle2 },
  rejected: { variant: 'danger', icon: XCircle },
  none: { variant: 'outline' },
}

export function VerificationBadge({
  status,
  className,
}: {
  status: ImpactVerificationStatus | 'none'
  className?: string
}) {
  return <StatusChip look={verificationLook[status]} label={verificationLabel[status]} className={className} />
}

const reviewLook: Record<ReviewStatus, Look> = {
  unreviewed: { variant: 'warning', icon: Eye },
  reviewed: { variant: 'success', icon: CheckCircle2 },
}

export function ReviewStatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  return <StatusChip look={reviewLook[status]} label={reviewStatusLabel[status]} className={className} />
}
