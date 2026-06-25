import { useQuery } from '@tanstack/react-query'
import { Bot, Boxes, MessageSquare, Server } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type Agent, api, type Environment, type MemoryStore, type MemoryStoreAccess } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { isArchived } from './format'
import type { AgentFormState, EnvironmentFormState, SessionFormState, VaultFormState } from './types'

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

// The model catalog is now global: a single dropdown lists every available
// model across all vendors. Selecting a model pins both the vendor (provider)
// and the model id, since an agent must reference a concrete vendor + model.
function AgentProviderModelFields({
  value,
  setValue,
}: {
  value: AgentFormState
  setValue: (value: AgentFormState) => void
}) {
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.models,
    queryFn: () => api.listModels(),
  })
  const models = (modelsQuery.data?.data ?? []).filter((model) => model.availability === 'available')
  const selectedModelKey = value.model ? `${value.provider}::${value.model}` : ''
  const hasSelected = models.some((model) => model.providerId === value.provider && model.modelId === value.model)
  return (
    <Field>
      <FieldLabel htmlFor="field-model">Model</FieldLabel>
      <Select
        {...(selectedModelKey ? { value: selectedModelKey } : {})}
        onValueChange={(key) => {
          const [provider, ...rest] = key.split('::')
          setValue({ ...value, provider: provider ?? '', model: rest.join('::') })
        }}
      >
        <SelectTrigger id="field-model">
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {models.map((model) => (
              <SelectItem key={`${model.providerId}::${model.modelId}`} value={`${model.providerId}::${model.modelId}`}>
                {model.displayName || model.modelId} ({model.providerId})
              </SelectItem>
            ))}
            {value.model && !hasSelected ? (
              <SelectItem value={selectedModelKey}>
                {value.model} ({value.provider})
              </SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>
        Models come from the global vendor catalog. Picking one pins both the vendor and the model.
      </FieldDescription>
    </Field>
  )
}

export function SessionForm({
  value,
  setValue,
  agents,
  environments,
  memoryStores = [],
  onSubmit,
}: {
  value: SessionFormState
  setValue: (value: SessionFormState) => void
  agents: Agent[]
  environments: Environment[]
  memoryStores?: MemoryStore[]
  onSubmit: (event: FormEvent) => void
}) {
  const activeAgents = agents.filter((agent) => !isArchived(agent))
  const activeEnvironments = environments.filter((environment) => !isArchived(environment))
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
              ? `Agent provider/model: ${selectedAgent.providerId ?? 'None'} / ${selectedAgent.model ?? 'None'}`
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
        {memoryStores.length > 0 ? (
          <MemoryStoreAttachmentField memoryStores={memoryStores} value={value} setValue={setValue} />
        ) : null}
      </FieldGroup>
      <Button type="submit" disabled={!canSubmit}>
        <MessageSquare data-icon="inline-start" />
        Create session
      </Button>
    </form>
  )
}

function MemoryStoreAttachmentField({
  memoryStores,
  value,
  setValue,
}: {
  memoryStores: MemoryStore[]
  value: SessionFormState
  setValue: (value: SessionFormState) => void
}) {
  const refs = parseResourceRefs(value.resourceRefs)
  const memoryRefs = refs.filter((ref) => ref.type === 'memory_store')
  function updateMemoryStore(storeId: string, checked: boolean | 'indeterminate') {
    const nextRefs = refs.filter((ref) => !(ref.type === 'memory_store' && ref.storeId === storeId))
    if (checked === true) {
      nextRefs.push({ type: 'memory_store', storeId, access: 'read_only' })
    }
    setValue({ ...value, resourceRefs: JSON.stringify(nextRefs, null, 2) })
  }
  function updateAccess(storeId: string, access: MemoryStoreAccess) {
    const nextRefs = refs.map((ref) =>
      ref.type === 'memory_store' && ref.storeId === storeId ? { ...ref, access } : ref,
    )
    setValue({ ...value, resourceRefs: JSON.stringify(nextRefs, null, 2) })
  }
  return (
    <Field>
      <FieldLabel>Memory stores</FieldLabel>
      <div className="space-y-2 rounded-md border p-3">
        {memoryStores.map((store) => {
          const attached = memoryRefs.find((ref) => ref.storeId === store.id)
          return (
            <div key={store.id} className="flex flex-wrap items-center gap-3">
              <Checkbox
                id={`memory-store-${store.id}`}
                checked={Boolean(attached)}
                onCheckedChange={(checked) => updateMemoryStore(store.id, checked)}
              />
              <label htmlFor={`memory-store-${store.id}`} className="min-w-0 flex-1 text-sm font-medium">
                <span className="block truncate">{store.name}</span>
                {store.description ? (
                  <span className="block truncate text-xs font-normal text-muted-foreground">{store.description}</span>
                ) : null}
              </label>
              <Select
                value={attached?.access === 'read_write' ? 'read_write' : 'read_only'}
                disabled={!attached}
                onValueChange={(access) => updateAccess(store.id, access as MemoryStoreAccess)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="read_only">Read only</SelectItem>
                    <SelectItem value="read_write">Read write</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>
      <FieldDescription>AMA manages the mount path for attached memory stores.</FieldDescription>
    </Field>
  )
}

function parseResourceRefs(
  value: string,
): Array<Record<string, unknown> & { type?: string; storeId?: string; access?: string }> {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []
  } catch {
    return []
  }
}

function hostingModeLabel(value: Environment['hostingMode']) {
  return value === 'self_hosted' ? 'Self-hosted' : 'Cloud'
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
