import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PageHeader } from '@/console/components'
import { isArchived, parsePackages, parseVariables, stringifyJson } from '@/console/format'
import { EnvironmentForm } from '@/console/forms'
import type { EnvironmentFormState } from '@/console/types'
import { api, type Environment, type EnvironmentNetworkPolicy } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { EnvironmentDetailView } from './EnvironmentDetailView'
import { useEnvironmentActions } from './use-environment-actions'

function formStateFromEnvironment(environment: Environment): EnvironmentFormState {
  return {
    name: environment.metadata.name,
    description: environment.metadata.description ?? '',
    hostingMode: environment.spec.hostingMode,
    networkMode: environment.spec.networkPolicy.mode,
    allowedHosts:
      environment.spec.networkPolicy.mode === 'restricted'
        ? environment.spec.networkPolicy.allowedHosts.join('\n')
        : '',
    packages: environment.spec.packages.map((pkg) => `${pkg.name}@${pkg.version ?? 'latest'}`).join('\n'),
    variables: Object.entries(environment.spec.variables)
      .map(
        ([name, variable]) =>
          `${name}=${typeof variable === 'object' && variable && 'value' in variable ? String(variable.value ?? '') : String(variable)}`,
      )
      .join('\n'),
    runtimeConfig: stringifyJson(environment.spec.runtimeConfig),
  }
}

function networkPolicyFromForm(form: EnvironmentFormState): EnvironmentNetworkPolicy {
  if (form.networkMode === 'restricted') {
    return {
      mode: 'restricted',
      allowedHosts: form.allowedHosts
        .split(/\r?\n/)
        .map((host) => host.trim())
        .filter(Boolean),
    }
  }
  return { mode: form.networkMode }
}

export function EnvironmentDetailPage() {
  const { environmentId } = useParams()
  const queryClient = useQueryClient()
  const actions = useEnvironmentActions()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EnvironmentFormState | null>(null)
  const [formErrors, setFormErrors] = useState<{ name?: string }>({})
  const environmentQuery = useQuery({
    queryKey: queryKeys.environments.detail(environmentId ?? ''),
    queryFn: () => api.readEnvironment(environmentId as string),
    enabled: Boolean(environmentId),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(),
  })
  const environment = environmentQuery.data ?? null
  const updateEnvironment = useMutation({
    mutationFn: (input: EnvironmentFormState) =>
      api.updateEnvironment(environmentId as string, {
        name: input.name,
        description: input.description,
        hostingMode: input.hostingMode,
        packages: parsePackages(input.packages),
        variables: parseVariables(input.variables),
        networkPolicy: networkPolicyFromForm(input),
        runtimeConfig: JSON.parse(input.runtimeConfig) as Record<string, unknown>,
      }),
    onSuccess: () => {
      toast.success('Environment updated')
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Environment"
        title={environment?.metadata.name ?? 'Environment detail'}
        description={
          environment?.metadata.description ?? 'Inspect runtime config, package policy, network policy, and bindings.'
        }
        actions={
          environment && !isArchived(environment) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(formStateFromEnvironment(environment))
                setEditing(true)
              }}
            >
              <Pencil data-icon="inline-start" />
              Edit environment
            </Button>
          ) : null
        }
      />
      <EnvironmentDetailView
        environment={environment}
        sessions={sessionsQuery.data?.data ?? []}
        onArchive={actions.archiveEnvironment}
      />
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Edit environment</SheetTitle>
            <SheetDescription>
              Saving creates a new immutable environment version; existing sessions keep their snapshots.
            </SheetDescription>
          </SheetHeader>
          {form ? (
            <div className="px-4 pb-6">
              <EnvironmentForm
                value={form}
                setValue={(value) => {
                  setForm(value)
                  if (value.name.trim()) setFormErrors({})
                }}
                errors={formErrors}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!form.name.trim()) {
                    setFormErrors({ name: 'Name is required' })
                    return
                  }
                  updateEnvironment.mutate(form)
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
