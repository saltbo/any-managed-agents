import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { isArchived } from '@/console/format'
import { TextAreaField, TextField } from '@/console/forms'
import { api, type RuntimeName } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_RESOURCES: never[] = []

const INTERVAL_UNITS = {
  minutes: 60,
  hours: 3600,
  days: 86400,
} as const

type IntervalUnit = keyof typeof INTERVAL_UNITS

interface TriggerFormState {
  name: string
  agentId: string
  environmentId: string
  runtime: RuntimeName
  promptTemplate: string
  intervalValue: string
  intervalUnit: IntervalUnit
  enabled: boolean
}

const emptyTrigger: TriggerFormState = {
  name: '',
  agentId: '',
  environmentId: '',
  runtime: 'ama',
  promptTemplate: '',
  intervalValue: '1',
  intervalUnit: 'days',
  enabled: true,
}

const MIN_INTERVAL_SECONDS = 60

function intervalSeconds(form: TriggerFormState) {
  const value = Number.parseInt(form.intervalValue, 10)
  if (!Number.isFinite(value) || value < 1) {
    return MIN_INTERVAL_SECONDS
  }
  return Math.max(MIN_INTERVAL_SECONDS, value * INTERVAL_UNITS[form.intervalUnit])
}

export function CreateTriggerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<TriggerFormState>(emptyTrigger)
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(false),
    queryFn: () => api.listAgents(),
    enabled: open,
  })
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(false),
    queryFn: () => api.listEnvironments(),
    enabled: open,
  })
  const agents = (agentsQuery.data?.data ?? EMPTY_RESOURCES).filter((agent) => !isArchived(agent))
  const environments = (environmentsQuery.data?.data ?? EMPTY_RESOURCES).filter(
    (environment) => !isArchived(environment),
  )
  const createTrigger = useMutation({
    mutationFn: () =>
      api.createTrigger({
        agentId: form.agentId,
        environmentId: form.environmentId,
        runtime: form.runtime,
        name: form.name,
        promptTemplate: form.promptTemplate,
        schedule: { type: 'interval', intervalSeconds: intervalSeconds(form) },
        enabled: form.enabled,
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyTrigger)
      toast.success('Trigger created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  useEffect(() => {
    if (!open) return
    setForm((current) => {
      const nextAgentId = current.agentId || agents[0]?.id || ''
      const nextEnvironmentId = current.environmentId || environments[0]?.id || ''
      if (current.agentId === nextAgentId && current.environmentId === nextEnvironmentId) {
        return current
      }
      return { ...current, agentId: nextAgentId, environmentId: nextEnvironmentId }
    })
  }, [agents, environments, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    createTrigger.mutate()
  }

  const canSubmit = Boolean(
    form.name.trim() && form.agentId && form.environmentId && form.promptTemplate.trim() && form.intervalValue.trim(),
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Create Trigger</SheetTitle>
          <SheetDescription>Schedule an agent to dispatch on a recurring interval.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
              <Field>
                <FieldLabel>Agent</FieldLabel>
                <Select value={form.agentId} onValueChange={(agentId) => setForm({ ...form, agentId })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>The trigger dispatches the current version of this agent.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Environment</FieldLabel>
                <Select
                  value={form.environmentId}
                  onValueChange={(environmentId) => setForm({ ...form, environmentId })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an environment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {environments.map((environment) => (
                        <SelectItem key={environment.id} value={environment.id}>
                          {environment.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Select the hosting and policy environment for dispatched sessions.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Runtime</FieldLabel>
                <Select
                  value={form.runtime}
                  onValueChange={(runtime) => setForm({ ...form, runtime: runtime as RuntimeName })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="ama">AMA</SelectItem>
                      <SelectItem value="claude-code">Claude Code</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="copilot">Copilot</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Runtime used for every dispatched session.</FieldDescription>
              </Field>
              <TextAreaField
                label="Prompt template"
                description="The prompt the agent runs on each scheduled dispatch."
                value={form.promptTemplate}
                onChange={(promptTemplate) => setForm({ ...form, promptTemplate })}
              />
              <Field>
                <FieldLabel htmlFor="field-interval">Interval</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="field-interval"
                    type="number"
                    min={1}
                    aria-label="Interval value"
                    value={form.intervalValue}
                    onChange={(event) => setForm({ ...form, intervalValue: event.target.value })}
                    className="w-28"
                  />
                  <Select
                    value={form.intervalUnit}
                    onValueChange={(intervalUnit) => setForm({ ...form, intervalUnit: intervalUnit as IntervalUnit })}
                  >
                    <SelectTrigger className="w-40" aria-label="Interval unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="minutes">minutes</SelectItem>
                        <SelectItem value="hours">hours</SelectItem>
                        <SelectItem value="days">days</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <FieldDescription>The minimum effective granularity is 1 minute.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={form.enabled ? 'active' : 'paused'}
                  onValueChange={(status) => setForm({ ...form, enabled: status === 'active' })}
                >
                  <SelectTrigger aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="paused">paused</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Paused triggers are created but do not dispatch until resumed.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={!canSubmit || createTrigger.isPending}>
              <AlarmClock data-icon="inline-start" />
              Create trigger
            </Button>
          </form>
          {createTrigger.error ? (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage(createTrigger.error)}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
