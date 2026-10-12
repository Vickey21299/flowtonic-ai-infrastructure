/**
 * Action tracker (Spec §10). State machine:
 * proposed → approved → in_progress → completed → outcome_verification → verified | reopened;
 * reopened → in_progress; cancelled from proposed / approved / in_progress / reopened.
 */
import type {
  ActionCreateInput,
  ActionDetail,
  ActionFilters,
  ActionStatus,
  ActionSummary,
  ActionTransitionRequest,
  ActionUpdateInput,
  EvidenceItem,
  Priority,
} from '@/api/types'
import { ApiError } from '@/api/errors'
import { db, nextId, type ActionRecord } from './store'
import { audit, clone, currentActor, DATE_RE, notFound, nowIso, validationError } from './util'
import { ACTION_TRANSITIONS, isOverdue, toActionDetail, toActionSummary } from './views'

type FieldError = { field: string; message: string }

const PRIORITIES: Priority[] = ['high', 'medium', 'low']
const TERMINAL: ActionStatus[] = ['verified', 'cancelled']
/** Statuses that require owner, due date and priority to be set. */
const COMMITTED: ActionStatus[] = ['approved', 'in_progress', 'completed', 'outcome_verification', 'verified', 'reopened']

export function findAction(id: string): ActionRecord {
  const a = db().actions.find((x) => x.id === id)
  if (!a) notFound('Action', id)
  return a
}

export function listActionsDemo(f: ActionFilters): ActionSummary[] {
  const s = db()
  const owner = f.owner?.trim().toLowerCase()
  return clone(
    s.actions
      .filter((a) =>
        !f.status
          ? true
          : f.status === 'awaiting_verification'
            ? a.status === 'completed' || a.status === 'outcome_verification'
            : a.status === f.status,
      )
      .filter((a) => !f.priority || a.priority === f.priority)
      .filter((a) => !owner || (a.owner ?? '').toLowerCase() === owner)
      .filter((a) => !f.companyId || a.companyId === f.companyId)
      .filter((a) => f.overdue === undefined || isOverdue(a) === f.overdue)
      .map((a) => toActionSummary(s, a))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
  )
}

export function getActionDemo(id: string): ActionDetail {
  return toActionDetail(db(), findAction(id))
}

function checkFields(input: ActionUpdateInput, errors: FieldError[]): void {
  if (input.title !== undefined && !input.title.trim()) errors.push({ field: 'title', message: 'A title is required.' })
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) {
    errors.push({ field: 'priority', message: 'Priority must be high, medium or low.' })
  }
  if (input.dueDate && !DATE_RE.test(input.dueDate)) {
    errors.push({ field: 'dueDate', message: 'Use a date in YYYY-MM-DD format.' })
  }
}

export function createActionDemo(input: ActionCreateInput): ActionDetail {
  const s = db()
  const errors: FieldError[] = []
  const exception = s.exceptions.find((e) => e.id === input.exceptionId)
  if (!exception) errors.push({ field: 'exceptionId', message: 'Select the exception this action addresses.' })
  if (input.investigationId) {
    const inv = s.investigations.find((i) => i.id === input.investigationId)
    if (!inv) errors.push({ field: 'investigationId', message: `Investigation "${input.investigationId}" was not found.` })
    else if (inv.exceptionId !== input.exceptionId) {
      errors.push({ field: 'investigationId', message: 'The investigation belongs to a different exception.' })
    }
  }
  if (!input.title?.trim()) errors.push({ field: 'title', message: 'A title is required.' })
  if (!PRIORITIES.includes(input.priority)) errors.push({ field: 'priority', message: 'Priority must be high, medium or low.' })
  checkFields({ dueDate: input.dueDate ?? null }, errors)
  if (errors.length || !exception) validationError(errors)

  const at = nowIso()
  const action: ActionRecord = {
    id: nextId('ACT'),
    companyId: exception.companyId,
    exceptionId: exception.id,
    investigationId: input.investigationId ?? null,
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    priority: input.priority,
    owner: input.owner?.trim() || null,
    dueDate: input.dueDate || null,
    status: 'proposed',
    completionNotes: null,
    cancelReason: null,
    evidence: [],
    notes: [],
    history: [
      audit('Action created with status proposed', {
        at,
        detail: input.investigationId ? `From investigation ${input.investigationId}` : 'Created manually',
      }),
    ],
    createdAt: at,
    updatedAt: at,
  }
  s.actions.push(action)
  exception.history.push(audit(`Action ${action.id} proposed: ${action.title}`, { at }))
  return toActionDetail(s, action)
}

const show = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v)

export function updateActionDemo(id: string, patch: ActionUpdateInput): ActionDetail {
  const a = findAction(id)
  if (TERMINAL.includes(a.status)) {
    throw new ApiError('conflict', `A ${a.status} action can no longer be edited.`)
  }
  const errors: FieldError[] = []
  checkFields(patch, errors)
  if (COMMITTED.includes(a.status)) {
    if (patch.owner !== undefined && !patch.owner?.trim()) {
      errors.push({ field: 'owner', message: `An ${a.status.replace('_', ' ')} action must keep an owner.` })
    }
    if (patch.dueDate !== undefined && !patch.dueDate) {
      errors.push({ field: 'dueDate', message: `An ${a.status.replace('_', ' ')} action must keep a due date.` })
    }
  }
  if (errors.length) validationError(errors)

  const at = nowIso()
  const labels: Record<keyof ActionUpdateInput, string> = {
    title: 'Title',
    description: 'Description',
    priority: 'Priority',
    owner: 'Owner',
    dueDate: 'Due date',
  }
  let changed = false
  for (const key of Object.keys(labels) as (keyof ActionUpdateInput)[]) {
    if (!(key in patch) || patch[key] === undefined) continue
    let next = patch[key]
    if (typeof next === 'string') next = next.trim()
    if ((key === 'owner' || key === 'dueDate') && next === '') next = null
    const prev = a[key]
    if (next === prev) continue
    ;(a as unknown as Record<string, unknown>)[key] = next
    changed = true
    a.history.push(
      key === 'description'
        ? audit('Description edited', { at })
        : audit(`${labels[key]} changed: ${show(prev as string | null)} → ${show(next as string | null)}`, { at }),
    )
  }
  if (changed) a.updatedAt = at
  return toActionDetail(db(), a)
}

export function transitionActionDemo(id: string, req: ActionTransitionRequest): ActionDetail {
  const s = db()
  const a = findAction(id)
  const from = a.status
  const allowed = ACTION_TRANSITIONS[from]
  if (!allowed.includes(req.to)) {
    throw new ApiError('invalid_transition', `An action cannot move from ${from} to ${req.to}.`, {
      allowedTransitions: allowed,
    })
  }
  const impacts = s.impacts.filter((i) => i.actionId === id)
  const reason = req.reason?.trim() || null
  const completionNotes = req.completionNotes?.trim() || a.completionNotes
  const errors: FieldError[] = []
  switch (req.to) {
    case 'approved':
      if (!a.owner) errors.push({ field: 'owner', message: 'Assign an owner before approving.' })
      if (!a.dueDate) errors.push({ field: 'dueDate', message: 'Set a due date before approving.' })
      if (!a.priority) errors.push({ field: 'priority', message: 'Set a priority before approving.' })
      break
    case 'completed':
      if (!completionNotes) errors.push({ field: 'completionNotes', message: 'Completion notes are required.' })
      if (a.evidence.length === 0) {
        errors.push({ field: 'evidence', message: 'Record at least one evidence item before completing.' })
      }
      break
    case 'outcome_verification':
      if (impacts.length === 0) {
        errors.push({ field: 'impacts', message: 'Add at least one impact record before outcome verification.' })
      }
      break
    case 'verified':
      if (!impacts.some((i) => i.verificationStatus === 'verified')) {
        errors.push({ field: 'impacts', message: 'At least one impact record must be verified first.' })
      }
      break
    case 'cancelled':
    case 'reopened':
      if (!reason) errors.push({ field: 'reason', message: `A reason is required to mark the action ${req.to}.` })
      break
    default:
      break
  }
  if (errors.length) validationError(errors)

  const at = nowIso()
  a.status = req.to
  a.updatedAt = at
  if (req.to === 'completed') a.completionNotes = completionNotes
  if (req.to === 'cancelled') a.cancelReason = reason
  const detail =
    req.to === 'completed' ? `Completion notes: ${completionNotes}` : reason ? `Reason: ${reason}` : undefined
  a.history.push(audit(`Status changed: ${from} → ${req.to}`, detail ? { at, detail } : { at }))
  return toActionDetail(s, a)
}

export function addActionNoteDemo(id: string, text: string): ActionDetail {
  const a = findAction(id)
  const t = text.trim()
  if (!t) validationError([{ field: 'text', message: 'The note cannot be empty.' }])
  const at = nowIso()
  a.notes.push({ id: nextId('NOTE'), at, author: currentActor(), text: t })
  a.history.push(audit('Progress note added', { at }))
  a.updatedAt = at
  return toActionDetail(db(), a)
}

export function addActionEvidenceDemo(
  id: string,
  item: Pick<EvidenceItem, 'kind' | 'description' | 'reference'>,
): ActionDetail {
  const a = findAction(id)
  const errors: FieldError[] = []
  if (!['note', 'document_ref', 'link'].includes(item.kind)) errors.push({ field: 'kind', message: 'Unknown evidence type.' })
  if (!item.description?.trim()) errors.push({ field: 'description', message: 'Describe the evidence.' })
  if (item.kind !== 'note' && !item.reference?.trim()) {
    errors.push({ field: 'reference', message: 'A reference is required for documents and links.' })
  }
  if (errors.length) validationError(errors)
  const at = nowIso()
  const ev: EvidenceItem = { id: nextId('EVD'), at, kind: item.kind, description: item.description.trim() }
  if (item.reference?.trim()) ev.reference = item.reference.trim()
  a.evidence.push(ev)
  a.history.push(audit(`Evidence recorded: ${ev.description}`, { at }))
  a.updatedAt = at
  return toActionDetail(db(), a)
}
