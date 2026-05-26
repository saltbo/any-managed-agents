import { Bot, Boxes, Cloud, MessageSquare, Server } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Agent, Environment, ProviderInputType } from '@/lib/api'
import type { AgentFormState, EnvironmentFormState, ProviderFormState, SessionFormState, VaultFormState } from './types'

const PROVIDER_TYPES: ProviderInputType[] = [
  'workers-ai',
  'anthropic',
  'openai',
  'openai-compatible',
  'ollama',
  'other',
]

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
  onSubmit,
  submitLabel = 'Save agent',
}: {
  value: AgentFormState
  setValue: (value: AgentFormState) => void
  onSubmit: (event: FormEvent) => void
  submitLabel?: string
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
        <TextField label="Provider" value={value.provider} onChange={(provider) => setValue({ ...value, provider })} />
        <TextField label="Model" value={value.model} onChange={(model) => setValue({ ...value, model })} />
        <TextAreaField
          label="Skills"
          description="One stable skill reference per line, such as source@skill."
          value={value.skills}
          onChange={(skills) => setValue({ ...value, skills })}
        />
        <TextAreaField
          label="Allowed Pi tools"
          description="One Pi tool name per line. These names are passed to the runtime policy."
          value={value.allowedTools}
          onChange={(allowedTools) => setValue({ ...value, allowedTools })}
        />
        <TextAreaField
          label="MCP connectors"
          description="One connector id per line. Connectors must already be approved for the project."
          value={value.mcpConnectors}
          onChange={(mcpConnectors) => setValue({ ...value, mcpConnectors })}
        />
        <TextAreaField
          label="Metadata"
          description="JSON object for safe runtime metadata. Raw secret values belong in vaults."
          value={value.metadata}
          onChange={(metadata) => setValue({ ...value, metadata })}
        />
      </FieldGroup>
      <Button type="submit">
        <Bot data-icon="inline-start" />
        {submitLabel}
      </Button>
    </form>
  )
}

export function SessionForm({
  value,
  setValue,
  agents,
  environments,
  onSubmit,
}: {
  value: SessionFormState
  setValue: (value: SessionFormState) => void
  agents: Agent[]
  environments: Environment[]
  onSubmit: (event: FormEvent) => void
}) {
  const activeAgents = agents.filter((agent) => agent.status === 'active')
  const activeEnvironments = environments.filter((environment) => environment.status === 'active')
  const canSubmit = Boolean(value.agentId && value.environmentId)

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel>Agent</FieldLabel>
          <Select value={value.agentId} onValueChange={(agentId) => setValue({ ...value, agentId })}>
            <SelectTrigger>
              <SelectValue placeholder="Select an agent" />
            </SelectTrigger>
            <SelectContent>
              {activeAgents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>The session will run the current version of this agent.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Environment</FieldLabel>
          <Select value={value.environmentId} onValueChange={(environmentId) => setValue({ ...value, environmentId })}>
            <SelectTrigger>
              <SelectValue placeholder="Select an environment" />
            </SelectTrigger>
            <SelectContent>
              {activeEnvironments.map((environment) => (
                <SelectItem key={environment.id} value={environment.id}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>The environment is selected per session, not stored on the agent.</FieldDescription>
        </Field>
        <TextField
          label="Title"
          description="Optional short label used in session lists and detail headers."
          value={value.title}
          onChange={(title) => setValue({ ...value, title })}
        />
        <TextAreaField
          label="Metadata"
          description="JSON object for safe session metadata."
          value={value.metadata}
          onChange={(metadata) => setValue({ ...value, metadata })}
        />
        <TextAreaField
          label="Resource refs"
          description="JSON array of resource reference objects for this run."
          value={value.resourceRefs}
          onChange={(resourceRefs) => setValue({ ...value, resourceRefs })}
        />
        <TextAreaField
          label="Vault refs"
          description="JSON array of vault or credential reference objects. Do not paste raw secrets."
          value={value.vaultRefs}
          onChange={(vaultRefs) => setValue({ ...value, vaultRefs })}
        />
      </FieldGroup>
      <Button type="submit" disabled={!canSubmit}>
        <MessageSquare data-icon="inline-start" />
        Create session
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
          <Select value={value.type} onValueChange={(type) => setValue({ ...value, type: type as ProviderInputType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_TYPES.map((type) => (
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
