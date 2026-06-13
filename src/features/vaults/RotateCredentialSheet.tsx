import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcwKey } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { VaultCredential } from '@/lib/api'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function RotateCredentialSheet({
  vaultId,
  credential,
  onOpenChange,
}: {
  vaultId: string
  credential: VaultCredential | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [secretValue, setSecretValue] = useState('')
  const rotateCredential = useMutation({
    mutationFn: (credentialId: string) =>
      api.rotateVaultCredential(vaultId, credentialId, { provider: 'ama-managed', secretValue }),
    onSuccess: () => {
      onOpenChange(false)
      setSecretValue('')
      toast.success('Credential rotated')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId) })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    /* v8 ignore start -- credential is null only when sheet is closed; form can't be submitted then */
    if (!credential || secretValue === '') return
    /* v8 ignore stop */
    rotateCredential.mutate(credential.id)
  }

  return (
    <Sheet open={credential !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Rotate credential</SheetTitle>
          <SheetDescription>
            {/* v8 ignore start -- sheet is only open when credential !== null; the null fallback never renders */}
            {credential
              ? `Create a new active version for ${credential.name}. The previous version is kept as a safe reference for auditability.`
              : 'Create a new active credential version.'}
            {/* v8 ignore stop */}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="rotate-secret-value">New secret value</FieldLabel>
                <Input
                  id="rotate-secret-value"
                  type="password"
                  autoComplete="off"
                  value={secretValue}
                  onChange={(event) => setSecretValue(event.target.value)}
                />
                <FieldDescription>Accepted only in this request and stored encrypted.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={secretValue === '' || rotateCredential.isPending}>
              <RotateCcwKey data-icon="inline-start" />
              {rotateCredential.isPending ? 'Rotating credential' : 'Rotate credential'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
