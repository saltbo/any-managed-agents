import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcwKey } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { parseJsonObject } from '@/console/format'
import type { VaultCredential } from '@/lib/amarpc'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
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
  const [stringData, setStringData] = useState('')
  const rotateCredential = useMutation({
    mutationFn: (credentialId: string) =>
      api.rotateVaultCredential(vaultId, credentialId, {
        stringData: Object.fromEntries(
          Object.entries(parseJsonObject(stringData, 'String data')).map(([key, value]) => [key, String(value)]),
        ),
      }),
    onSuccess: () => {
      onOpenChange(false)
      setStringData('')
      toast.success('Credential rotated')
      void queryClient.invalidateQueries({ queryKey: queryKeys.vaults.detail(vaultId) })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    /* v8 ignore start -- credential is null only when sheet is closed; form can't be submitted then */
    if (!credential || stringData.trim() === '') return
    /* v8 ignore stop */
    rotateCredential.mutate(credential.metadata.uid)
  }

  return (
    <Sheet open={credential !== null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Rotate credential</SheetTitle>
          <SheetDescription>
            {/* v8 ignore start -- sheet is only open when credential !== null; the null fallback never renders */}
            {credential
              ? `Create a new active version for ${credential.metadata.name}. The previous version is kept as a safe reference for auditability.`
              : 'Create a new active credential version.'}
            {/* v8 ignore stop */}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="rotate-string-data">New string data</FieldLabel>
                <Textarea
                  id="rotate-string-data"
                  autoComplete="off"
                  value={stringData}
                  onChange={(event) => setStringData(event.target.value)}
                />
                <FieldDescription>JSON object accepted only in this request and stored encrypted.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={stringData.trim() === '' || rotateCredential.isPending}>
              <RotateCcwKey data-icon="inline-start" />
              {rotateCredential.isPending ? 'Rotating credential' : 'Rotate credential'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
