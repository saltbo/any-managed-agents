import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TextField } from '@/console/forms'
import { api, type ProviderAccessRuleInput } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

interface AccessRuleFormState {
  providerId: string
  modelId: string
  teamId: string
  effect: 'allow' | 'deny'
  reason: string
}

const emptyAccessRule: AccessRuleFormState = {
  providerId: '',
  modelId: '',
  teamId: '',
  effect: 'deny',
  reason: '',
}

export function CreateAccessRuleSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AccessRuleFormState>(emptyAccessRule)
  const [targetError, setTargetError] = useState<string | null>(null)
  const createRule = useMutation({
    mutationFn: (input: ProviderAccessRuleInput) => api.createProviderAccessRule(input),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyAccessRule)
      toast.success('Access rule saved')
      void queryClient.invalidateQueries({ queryKey: queryKeys.governance.accessRules })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const providerId = form.providerId.trim()
    const modelId = form.modelId.trim()
    if (!providerId && !modelId) {
      setTargetError('An access rule must target a provider id, a model id, or both.')
      return
    }
    setTargetError(null)
    createRule.mutate({
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(form.teamId.trim() ? { teamId: form.teamId.trim() } : {}),
      effect: form.effect,
      ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Add access rule</SheetTitle>
          <SheetDescription>
            Allow or deny provider and model access for this project. Team-scoped rules apply to OIDC team claims.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel>Effect</FieldLabel>
                <Select
                  value={form.effect}
                  onValueChange={(effect) => setForm({ ...form, effect: effect as AccessRuleFormState['effect'] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deny">Deny</SelectItem>
                    <SelectItem value="allow">Allow</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Deny rules block matching sessions. Team-scoped allow rules restrict access to listed teams.
                </FieldDescription>
              </Field>
              <TextField
                label="Provider id"
                description="Provider this rule matches, for example workers-ai. Leave empty to match by model only."
                value={form.providerId}
                onChange={(providerId) => setForm({ ...form, providerId })}
                {...(targetError ? { error: targetError } : {})}
              />
              <TextField
                label="Model id"
                description="Optional model this rule matches. Leave empty to match every model of the provider."
                value={form.modelId}
                onChange={(modelId) => setForm({ ...form, modelId })}
              />
              <TextField
                label="Team id"
                description="Optional OIDC team identifier this rule is scoped to."
                value={form.teamId}
                onChange={(teamId) => setForm({ ...form, teamId })}
              />
              <TextField
                label="Reason"
                description="Shown to users when this rule denies a session."
                value={form.reason}
                onChange={(reason) => setForm({ ...form, reason })}
              />
            </FieldGroup>
            <Button type="submit" disabled={createRule.isPending}>
              <ShieldCheck data-icon="inline-start" />
              {createRule.isPending ? 'Saving rule…' : 'Save access rule'}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
