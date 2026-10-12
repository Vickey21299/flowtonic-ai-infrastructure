import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import { isApiError } from '@/api/errors'
import type { ActionCreateInput, ActionDetail, Priority } from '@/api/types'
import { ErrorState } from '@/components/states/ErrorState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { priorityLabel, toOptions } from '@/lib/format'
import { queryKeys } from '@/lib/queryKeys'
import { useInvalidateActionData } from './actionShared'

interface Prefill {
  exceptionId?: string
  investigationId?: string
  title?: string
}

interface Props {
  open: boolean
  prefill: Prefill
  onClose: () => void
  onCreated: (action: ActionDetail) => void
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-xs text-status-danger">
      {message}
    </p>
  )
}

export function CreateActionDialog({ open, prefill, onClose, onCreated }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {/* Remount per opening so the form starts from the current pre-fill. */}
        {open && <CreateForm key={JSON.stringify(prefill)} prefill={prefill} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({ prefill, onClose, onCreated }: Omit<Props, 'open'>) {
  const invalidate = useInvalidateActionData()
  const filters = { status: 'not_resolved' as const }
  const exceptions = useQuery({ queryKey: queryKeys.exceptions(filters), queryFn: () => api.listExceptions(filters) })

  const [exceptionId, setExceptionId] = useState(prefill.exceptionId ?? '')
  const [title, setTitle] = useState(prefill.title ?? '')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [owner, setOwner] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  // The investigation link only applies while the pre-filled exception is still selected.
  const investigationId = prefill.investigationId && exceptionId === prefill.exceptionId ? prefill.investigationId : null

  const create = useMutation({
    mutationFn: (input: ActionCreateInput) => api.createAction(input),
    onSuccess: async (a) => {
      await invalidate()
      onCreated(a)
    },
  })

  const apiErr = isApiError(create.error) ? create.error : null
  const err = (f: string) => clientErrors[f] ?? apiErr?.fieldErrors.find((e) => e.field === f)?.message
  const describedBy = (f: string) => (err(f) ? `new-action-${f}-err` : undefined)

  const submit = () => {
    const errors: Record<string, string> = {}
    if (!exceptionId) errors.exceptionId = 'Select the exception this action addresses.'
    if (!title.trim()) errors.title = 'A title is required.'
    if (!priority) errors.priority = 'Choose a priority.'
    setClientErrors(errors)
    if (Object.keys(errors).length || !priority) return
    create.mutate({
      exceptionId,
      investigationId,
      title: title.trim(),
      description: description.trim(),
      priority,
      owner: owner.trim() || null,
      dueDate: dueDate || null,
    })
  }

  const options = exceptions.data ?? []
  const prefilledMissing = prefill.exceptionId && !options.some((e) => e.id === prefill.exceptionId)
  const unmatchedErrors = apiErr?.fieldErrors.filter(
    (f) => !['exceptionId', 'title', 'priority', 'owner', 'dueDate', 'description'].includes(f.field),
  )

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>New action</DialogTitle>
        <DialogDescription>
          The action is created as <strong>Proposed</strong>. An owner and a due date are required before it can be approved.
        </DialogDescription>
      </DialogHeader>

      {investigationId && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Linked to investigation <span className="font-mono">{investigationId}</span>. Suggested actions are reviewed by a
          person before they are created.
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="new-action-exceptionId">Related exception (required)</Label>
        <NativeSelect
          id="new-action-exceptionId"
          value={exceptionId}
          onChange={(e) => setExceptionId(e.target.value)}
          aria-invalid={Boolean(err('exceptionId'))}
          aria-describedby={describedBy('exceptionId')}
          disabled={exceptions.isPending}
        >
          <option value="">{exceptions.isPending ? 'Loading exceptions…' : 'Choose an exception…'}</option>
          {prefilledMissing && <option value={prefill.exceptionId}>{prefill.exceptionId}</option>}
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id} · {e.companyName} · {e.metricLabel} ({e.ruleLabel})
            </option>
          ))}
        </NativeSelect>
        {exceptions.isError && <p className="text-xs text-status-danger">Could not load exceptions.</p>}
        <FieldError id="new-action-exceptionId-err" message={err('exceptionId')} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-action-title">Title (required)</Label>
        <Input
          id="new-action-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={Boolean(err('title'))}
          aria-describedby={describedBy('title')}
        />
        <FieldError id="new-action-title-err" message={err('title')} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-action-description">Description</Label>
        <Textarea id="new-action-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <FieldError id="new-action-description-err" message={err('description')} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="new-action-priority">Priority (required)</Label>
          <NativeSelect
            id="new-action-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | '')}
            aria-invalid={Boolean(err('priority'))}
            aria-describedby={describedBy('priority')}
          >
            <option value="">Choose…</option>
            {toOptions(priorityLabel).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError id="new-action-priority-err" message={err('priority')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-action-owner">Owner</Label>
          <Input
            id="new-action-owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            aria-invalid={Boolean(err('owner'))}
            aria-describedby={describedBy('owner')}
          />
          <FieldError id="new-action-owner-err" message={err('owner')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-action-dueDate">Due date</Label>
          <Input
            id="new-action-dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={Boolean(err('dueDate'))}
            aria-describedby={describedBy('dueDate')}
          />
          <FieldError id="new-action-dueDate-err" message={err('dueDate')} />
        </div>
      </div>

      {create.isError && (!apiErr || apiErr.fieldErrors.length === 0) && (
        <ErrorState compact title="Could not create the action" error={create.error} />
      )}
      {unmatchedErrors && unmatchedErrors.length > 0 && (
        <ul className="list-inside list-disc text-xs text-status-danger">
          {unmatchedErrors.map((f, i) => (
            <li key={i}>
              {f.field}: {f.message}
            </li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create proposed action'}
        </Button>
      </DialogFooter>
    </form>
  )
}
