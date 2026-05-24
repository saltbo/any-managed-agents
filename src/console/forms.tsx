import { Bot, Boxes, Cloud, Server } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Environment } from '@/lib/api'
import type { AgentFormState, EnvironmentFormState, ProviderFormState, VaultFormState } from './types'

export function EnvironmentForm({
  value,
  setValue,
  onSubmit,
}: {
  value: EnvironmentFormState
  setValue: (value: EnvironmentFormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <TextAreaField
          label="Packages"
          description="One package per line. Use name@version when a version is required."
          value={value.packages}
          onChange={(packages) => setValue({ ...value, packages })}
        />
        <TextAreaField
          label="Variables"
          description="One variable per line using KEY=description. Secret values are stored separately."
          value={value.variables}
          onChange={(variables) => setValue({ ...value, variables })}
        />
        <TextField
          label="Runtime image"
          description="Container image baked with runtime dependencies. Leave the default unless the image is ready."
          value={value.runtimeImage}
          onChange={(runtimeImage) => setValue({ ...value, runtimeImage })}
        />
      </FieldGroup>
      <Button type="submit">
        <Server data-icon="inline-start" />
        Save environment
      </Button>
    </form>
  )
}

export function AgentForm({
  value,
  setValue,
  environments,
  selectedEnvironmentId,
  setSelectedEnvironmentId,
  onSubmit,
}: {
  value: AgentFormState
  setValue: (value: AgentFormState) => void
  environments: Environment[]
  selectedEnvironmentId: string
  setSelectedEnvironmentId: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <TextAreaField
          label="Instructions"
          description="Operational instructions the runtime agent follows for every session."
          value={value.instructions}
          onChange={(instructions) => setValue({ ...value, instructions })}
        />
        <TextAreaField
          label="Allowed Pi tools"
          description="One Pi tool name per line. These names are passed to the runtime policy."
          value={value.allowedTools}
          onChange={(allowedTools) => setValue({ ...value, allowedTools })}
        />
        <Field>
          <FieldLabel>Default environment</FieldLabel>
          <Select
            value={selectedEnvironmentId || 'none'}
            onValueChange={(value) => setSelectedEnvironmentId(value === 'none' ? '' : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {environments
                .filter((environment) => environment.status === 'active')
                .map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    {environment.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <FieldDescription>Used when starting a session from this agent.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit">
        <Bot data-icon="inline-start" />
        Save agent
      </Button>
    </form>
  )
}

export function ProviderForm({
  value,
  setValue,
  onSubmit,
}: {
  value: ProviderFormState
  setValue: (value: ProviderFormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel>Provider type</FieldLabel>
          <Select value={value.type} onValueChange={(type) => setValue({ ...value, type })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['workers-ai', 'anthropic', 'openai', 'openai-compatible', 'ollama', 'other'].map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>Provider identifiers match the OpenAPI provider contract.</FieldDescription>
        </Field>
        <TextField
          label="Display name"
          value={value.displayName}
          onChange={(displayName) => setValue({ ...value, displayName })}
        />
        <TextField
          label="Base URL"
          description="Required only for OpenAI-compatible or custom providers."
          value={value.baseUrl}
          onChange={(baseUrl) => setValue({ ...value, baseUrl })}
        />
        <TextField
          label="Credential secret ref"
          description="Secret references point at approved vaults or Cloudflare Secrets. Raw secret values are never accepted here."
          value={value.credentialSecretRef}
          onChange={(credentialSecretRef) => setValue({ ...value, credentialSecretRef })}
        />
      </FieldGroup>
      <Button type="submit">
        <Cloud data-icon="inline-start" />
        Save provider
      </Button>
    </form>
  )
}

export function VaultForm({
  value,
  setValue,
  onSubmit,
}: {
  value: VaultFormState
  setValue: (value: VaultFormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <Field>
          <FieldLabel>Scope</FieldLabel>
          <Select
            value={value.scope}
            onValueChange={(scope) => setValue({ ...value, scope: scope as VaultFormState['scope'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">project</SelectItem>
              <SelectItem value="organization">organization</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Project vaults are the default for runtime credential references.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit">
        <Boxes data-icon="inline-start" />
        Save vault
      </Button>
    </form>
  )
}

function TextField({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
}) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function TextAreaField({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
}) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}
