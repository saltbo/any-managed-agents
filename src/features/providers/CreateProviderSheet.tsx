import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptyProvider } from '@/console/defaults'
import { ProviderForm } from '@/console/forms'
import type { ProviderFormState } from '@/console/types'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function CreateProviderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ProviderFormState>(emptyProvider)
  const createProvider = useMutation({
    mutationFn: () =>
      api.createProvider({
        type: form.type,
        displayName: form.displayName,
        ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}),
        ...(form.credentialSecretRef ? { credentialSecretRef: form.credentialSecretRef } : {}),
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyProvider)
      toast.success('Provider created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    createProvider.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Create Provider</SheetTitle>
          <SheetDescription>Register a model provider without exposing raw credentials.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <ProviderForm value={form} setValue={setForm} onSubmit={submit} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
