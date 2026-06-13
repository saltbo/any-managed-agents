import { useQuery } from '@tanstack/react-query'
import { Bot, Boxes, Cloud, MessageSquare, Server } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type Agent, api, type Environment, type ProviderInputType } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
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
  errors,
}: {
  value: EnvironmentFormState
  setValue: (value: EnvironmentFormState) => void
  onSubmit: (event: FormEvent) => void
  errors?: { name?: string }
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField
          label="Name"
          value={value.name}
          onChange={(name) => setValue({ ...value, name })}
          {...(errors?.name ? { error: errors.name } : {})}
        />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <Field>
          <FieldLabel>Hosting mode</FieldLabel>
          <Select
            value={value.hostingMode}
            onValueChange={(hostingMode) =>
              setValue({ ...value, hostingMode: hostingMode as EnvironmentFormState['hostingMode'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="cloud">Cloud</SelectItem>
                <SelectItem value="self_hosted">Self-hosted</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Cloud sessions start in Cloudflare Sandbox. Self-hosted sessions wait for a runner.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Network mode</FieldLabel>
          <Select
            value={value.networkMode}
            onValueChange={(networkMode) =>
              setValue({ ...value, networkMode: networkMode as EnvironmentFormState['networkMode'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="restricted">Restricted</SelectItem>
                <SelectItem value="unrestricted">Unrestricted</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Restricted mode allows only the hosts listed below. Offline mode blocks outbound requests.
          </FieldDescription>
        </Field>
        {value.networkMode === 'restricted' ? (
          <TextAreaField
            label="Allowed hosts"
            description="One lowercase hostname per line. Do not include protocols, paths, or ports."
            value={value.allowedHosts}
            onChange={(allowedHosts) => setValue({ ...value, allowedHosts })}
          />
        ) : null}
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
        <TextAreaField
          label="Runtime config"
          description="JSON object for runtime-specific configuration. Secret values are stored separately."
          value={value.runtimeConfig}
          onChange={(runtimeConfig) => setValue({ ...value, runtimeConfig })}
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
          description="Operational instructions the Agent follows for every session."
          value={value.instructions}
          onChange={(instructions) => setValue({ ...value, instructions })}
        />
        <AgentProviderModelFields value={value} setValue={setValue} />
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

const PLATFORM_PROVIDER_ID = 'workers-ai'
const NO_MODEL_VALUE = '__no-model__'

// Provider and model choices come from the configured provider catalog, so an
// agent can only reference providers whose connection details the runtime can
// actually dispatch. Workers AI is always offered as the platform default.
function AgentProviderModelFields({
  value,
  setValue,
}: {
  value: AgentFormState
  setValue: (value: AgentFormState) => void
}) {
  const providersQuery = useQuery({
    queryKey: queryKeys.providers.list(),
    queryFn: () => api.listProviders(),
  })
  const configuredProviders = (providersQuery.data?.data ?? []).filter(
    (provider) => provider.status === 'active' && provider.type !== PLATFORM_PROVIDER_ID,
  )
  const knownProviderIds = new Set([PLATFORM_PROVIDER_ID, ...configuredProviders.map((provider) => provider.id)])
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.models(value.provider),
    queryFn: () => api.listProviderModels(value.provider),
    enabled: Boolean(value.provider),
  })
  const modelIds = (modelsQuery.data?.data ?? [])
    .filter((model) => model.availability === 'available')
    .map((model) => model.modelId)
  return (
    <>
      <Field>
        <FieldLabel htmlFor="field-provider">Provider</FieldLabel>
        <Select value={value.provider} onValueChange={(provider) => setValue({ ...value, provider, model: '' })}>
          <SelectTrigger id="field-provider">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={PLATFORM_PROVIDER_ID}>Workers AI (platform)</SelectItem>
              {configuredProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.displayName} ({provider.type})
                </SelectItem>
              ))}
              {value.provider && !knownProviderIds.has(value.provider) ? (
                <SelectItem value={value.provider}>{value.provider}</SelectItem>
              ) : null}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Sessions dispatch the configured provider base URL and vault credential to the runtime.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="field-model">Model</FieldLabel>
        <Select
          value={value.model || NO_MODEL_VALUE}
          onValueChange={(model) => setValue({ ...value, model: model === NO_MODEL_VALUE ? '' : model })}
        >
          <SelectTrigger id="field-model">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={NO_MODEL_VALUE}>No pinned model</SelectItem>
              {modelIds.map((modelId) => (
                <SelectItem key={modelId} value={modelId}>
                  {modelId}
                </SelectItem>
              ))}
              {value.model && !modelIds.includes(value.model) ? (
                <SelectItem value={value.model}>{value.model}</SelectItem>
              ) : null}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Models come from the provider catalog. Leave unpinned to let the runtime decide.
        </FieldDescription>
      </Field>
    </>
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
  const selectedAgent = activeAgents.find((agent) => agent.id === value.agentId)
  const selectedEnvironment = activeEnvironments.find((environment) => environment.id === value.environmentId)
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
              <SelectGroup>
                {activeAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedAgent
              ? `Agent provider/model: ${selectedAgent.provider} / ${selectedAgent.model}`
              : 'The session will run the current version of this agent.'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Environment</FieldLabel>
          <Select value={value.environmentId} onValueChange={(environmentId) => setValue({ ...value, environmentId })}>
            <SelectTrigger>
              <SelectValue placeholder="Select an environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {activeEnvironments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    {environment.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedEnvironment
              ? `Hosting mode: ${hostingModeLabel(selectedEnvironment.hostingMode)}`
              : 'Select the hosting and policy environment for this session.'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Runtime</FieldLabel>
          <Select
            value={value.runtime}
            onValueChange={(runtime) => setValue({ ...value, runtime: runtime as SessionFormState['runtime'] })}
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
          <FieldDescription>Runtime is selected per session.</FieldDescription>
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
          description='JSON array of safe refs, such as {"type":"github_repository","owner":"org","repo":"repo"}.'
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

function hostingModeLabel(value: Environment['hostingMode']) {
  return value === 'self_hosted' ? 'Self-hosted' : 'Cloud'
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
              <SelectGroup>
                {PROVIDER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectGroup>
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
          description="Use a vault credential version id (vaultver_…) so sessions can dispatch the credential to the runtime. Raw secret values are never accepted here."
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
              <SelectGroup>
                <SelectItem value="project">project</SelectItem>
                <SelectItem value="organization">organization</SelectItem>
              </SelectGroup>
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

export function TextField({
  label,
  description,
  value,
  onChange,
  error,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
}) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export function TextAreaField({
  label,
  description,
  value,
  onChange,
  error,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
}) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
