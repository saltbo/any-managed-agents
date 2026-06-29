import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptyEnvironment } from '@/console/defaults'
import { parsePackages, parseVariables } from '@/console/format'
import { EnvironmentForm } from '@/console/forms'
import type { EnvironmentFormState } from '@/console/types'
import type { EnvironmentNetworking } from '@/lib/amarpc'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

function parseAllowedHosts(value: string) {
  return value
    .split(/\r?\n/)
    .map((host) => host.trim())
    .filter(Boolean)
}

function networking(form: EnvironmentFormState): EnvironmentNetworking {
  if (form.networkingType === 'limited') {
    return {
      type: 'limited',
      allowMcpServers: form.allowMcpServers,
      allowPackageManagers: form.allowPackageManagers,
      allowedHosts: parseAllowedHosts(form.allowedHosts),
    }
  }
  return {
    type: form.networkingType,
    allowMcpServers: form.allowMcpServers,
    allowPackageManagers: form.allowPackageManagers,
  }
}

export function CreateEnvironmentSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<EnvironmentFormState>(emptyEnvironment)
  const createEnvironment = useMutation({
    mutationFn: () =>
      api.createEnvironment({
        name: form.name,
        description: form.description,
        type: form.type,
        networking: networking(form),
        packages: parsePackages(form.packages),
        variables: parseVariables(form.variables),
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyEnvironment)
      toast.success('Environment created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createEnvironment.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Create Environment</SheetTitle>
          <SheetDescription>Define a reusable execution environment for future sessions.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <EnvironmentForm value={form} setValue={setForm} onSubmit={submit} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
