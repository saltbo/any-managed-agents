import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { parseJsonObject } from '@/console/format'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

interface CredentialFormState {
  name: string
  type: string
  connectorId: string
  connectorBindingName: string
  secretValue: string
  metadata: string
}

const emptyCredential: CredentialFormState = {
  name: '',
  type: '',
  connectorId: '',
  connectorBindingName: '',
  secretValue: '',
  metadata: '{}',
}

export function AddCredentialSheet({
  vaultId,
  open,
  onOpenChange,
}: {
  vaultId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CredentialFormState>(emptyCredential)
  const createCredential = useMutation({
    mutationFn: () =>
      api.createVaultCredential(vaultId, {
        name: form.name,
        type: form.type,
        connectorBinding: {
          ...(form.connectorId ? { connectorId: form.connectorId } : {}),
          ...(form.connectorBindingName ? { name: form.connectorBindingName } : {}),
        },
        metadata: parseJsonObject(form.metadata, 'Metadata'),
        secret: { provider: 'ama-managed', secretValue: form.secretValue },
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyCredential)
      toast.success('Credential stored')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId) })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const valid = form.name.trim() !== '' && form.type.trim() !== '' && form.secretValue !== ''
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    createCredential.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Add credential</SheetTitle>
          <SheetDescription>
            The secret value is encrypted at rest and never returned by the control plane.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="credential-name">Name</FieldLabel>
                <Input
                  id="credential-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="credential-type">Type</FieldLabel>
                <Input
                  id="credential-type"
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                />
                <FieldDescription>For example api_key or oauth_token.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="credential-connector-id">Connector binding</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    id="credential-connector-id"
                    placeholder="Connector id"
                    aria-label="Connector id"
                    value={form.connectorId}
                    onChange={(event) => setForm({ ...form, connectorId: event.target.value })}
                  />
                  <Input
                    id="credential-connector-binding-name"
                    placeholder="Binding name"
                    aria-label="Connector binding name"
                    value={form.connectorBindingName}
                    onChange={(event) => setForm({ ...form, connectorBindingName: event.target.value })}
                  />
                </div>
                <FieldDescription>Optional connector this credential is bound to.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="credential-secret-value">Secret value</FieldLabel>
                <Input
                  id="credential-secret-value"
                  type="password"
                  autoComplete="off"
                  value={form.secretValue}
                  onChange={(event) => setForm({ ...form, secretValue: event.target.value })}
                />
                <FieldDescription>Accepted only in this request and stored encrypted.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="credential-metadata">Metadata</FieldLabel>
                <Textarea
                  id="credential-metadata"
                  value={form.metadata}
                  onChange={(event) => setForm({ ...form, metadata: event.target.value })}
                />
                <FieldDescription>Safe JSON metadata. Never put secret material here.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={!valid || createCredential.isPending}>
              <KeyRound data-icon="inline-start" />
              {createCredential.isPending ? 'Saving credential' : 'Save credential'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
