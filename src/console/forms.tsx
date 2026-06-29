import { useQuery } from '@tanstack/react-query'
import { Bot, Boxes, MessageSquare, Server } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type Agent,
  api,
  type Environment,
  type MemoryStore,
  type MemoryStoreAccess,
  type Volume,
  type VolumeMount,
} from '@/lib/amarpc'
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
          <FieldLabel>Environment type</FieldLabel>
          <Select
            value={value.type}
            onValueChange={(type) => setValue({ ...value, type: type as EnvironmentFormState['type'] })}
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
            value={value.networkingType}
            onValueChange={(networkingType) =>
              setValue({ ...value, networkingType: networkingType as EnvironmentFormState['networkingType'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="limited">Limited</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Limited networking allows only the hosts listed below. Closed networking blocks outbound requests.
          </FieldDescription>
        </Field>
        {value.networkingType === 'limited' ? (
          <TextAreaField
            label="Allowed hosts"
            description="One lowercase hostname per line. Do not include protocols, paths, or ports."
            value={value.allowedHosts}
            onChange={(allowedHosts) => setValue({ ...value, allowedHosts })}
          />
        ) : null}
        <Field className="flex flex-row items-center gap-3">
          <Checkbox
            id="field-allow-mcp"
            checked={value.allowMcpServers}
            onCheckedChange={(checked) => setValue({ ...value, allowMcpServers: checked === true })}
          />
          <FieldLabel htmlFor="field-allow-mcp">Allow MCP servers</FieldLabel>
        </Field>
        <Field className="flex flex-row items-center gap-3">
          <Checkbox
            id="field-allow-package-managers"
            checked={value.allowPackageManagers}
            onCheckedChange={(checked) => setValue({ ...value, allowPackageManagers: checked === true })}
          />
          <FieldLabel htmlFor="field-allow-package-managers">Allow package managers</FieldLabel>
        </Field>
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
          value={value.systemPrompt}
          onChange={(systemPrompt) => setValue({ ...value, systemPrompt })}
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
  const selectedAgent = activeAgents.find((agent) => agent.metadata.uid === value.agentId)
  const selectedEnvironment = activeEnvironments.find((environment) => environment.metadata.uid === value.environmentId)
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
                  <SelectItem key={agent.metadata.uid} value={agent.metadata.uid}>
                    {agent.metadata.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedAgent
              ? `Agent provider/model: ${selectedAgent.spec.provider ?? 'None'} / ${selectedAgent.spec.model ?? 'None'}`
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
                  <SelectItem key={environment.metadata.uid} value={environment.metadata.uid}>
                    {environment.metadata.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedEnvironment
              ? `Environment type: ${hostingModeLabel(selectedEnvironment.spec.type)}`
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
          label="Name"
          description="Optional short name used in session lists and detail headers."
          value={value.name}
          onChange={(name) => setValue({ ...value, name })}
        />
        <TextAreaField
          label="Metadata"
          description="JSON object for safe session metadata."
          value={value.metadata}
          onChange={(metadata) => setValue({ ...value, metadata })}
        />
        <TextAreaField
          label="Volumes"
          description='JSON array of mountable inputs, such as {"name":"source","type":"git_repository","url":"https://github.com/org/repo.git"}.'
          value={value.volumes}
          onChange={(volumes) => setValue({ ...value, volumes })}
        />
        <TextAreaField
          label="Volume mounts"
          description='JSON array of mounts, such as {"name":"source","mountPath":"/workspace/repos/org/repo","readOnly":true}.'
          value={value.volumeMounts}
          onChange={(volumeMounts) => setValue({ ...value, volumeMounts })}
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
  const volumes = parseVolumes(value.volumes)
  const volumeMounts = parseVolumeMounts(value.volumeMounts)
  const memoryVolumes = volumes.filter((volume) => volume.type === 'memory')
  function updateMemoryStore(storeId: string, checked: boolean | 'indeterminate') {
    const name = memoryVolumeName(storeId)
    const memoryRef = memoryRefForStore(storeId)
    const nextVolumes = volumes.filter((volume) => !(volume.type === 'memory' && volume.memoryRef === memoryRef))
    const nextMounts = volumeMounts.filter((mount) => mount.name !== name)
    if (checked === true) {
      nextVolumes.push({ name, type: 'memory', memoryRef, access: 'read_only' })
      nextMounts.push({ name, mountPath: `/workspace/.ama/memory-stores/${storeId}`, readOnly: true })
    }
    setValue({
      ...value,
      volumes: JSON.stringify(nextVolumes, null, 2),
      volumeMounts: JSON.stringify(nextMounts, null, 2),
    })
  }
  function updateAccess(storeId: string, access: MemoryStoreAccess) {
    const name = memoryVolumeName(storeId)
    const memoryRef = memoryRefForStore(storeId)
    const nextVolumes = volumes.map((volume) =>
      volume.type === 'memory' && volume.memoryRef === memoryRef ? { ...volume, access } : volume,
    )
    const nextMounts = volumeMounts.map((mount) =>
      mount.name === name ? { ...mount, readOnly: access !== 'read_write' } : mount,
    )
    setValue({
      ...value,
      volumes: JSON.stringify(nextVolumes, null, 2),
      volumeMounts: JSON.stringify(nextMounts, null, 2),
    })
  }
  return (
    <Field>
      <FieldLabel>Memory stores</FieldLabel>
      <div className="space-y-2 rounded-md border p-3">
        {memoryStores.map((store) => {
          const attached = memoryVolumes.find((volume) => volume.memoryRef === memoryRefForStore(store.metadata.uid))
          return (
            <div key={store.metadata.uid} className="flex flex-wrap items-center gap-3">
              <Checkbox
                id={`memory-store-${store.metadata.uid}`}
                checked={Boolean(attached)}
                onCheckedChange={(checked) => updateMemoryStore(store.metadata.uid, checked)}
              />
              <label htmlFor={`memory-store-${store.metadata.uid}`} className="min-w-0 flex-1 text-sm font-medium">
                <span className="block truncate">{store.metadata.name}</span>
                {store.metadata.description ? (
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {store.metadata.description}
                  </span>
                ) : null}
              </label>
              <Select
                value={attached?.access === 'read_write' ? 'read_write' : 'read_only'}
                disabled={!attached}
                onValueChange={(access) => updateAccess(store.metadata.uid, access as MemoryStoreAccess)}
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

function parseVolumes(value: string): Array<Volume & { memoryRef?: string; access?: string }> {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as Array<Volume & { memoryRef?: string; access?: string }>) : []
  } catch {
    return []
  }
}

function parseVolumeMounts(value: string): VolumeMount[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as VolumeMount[]) : []
  } catch {
    return []
  }
}

function memoryVolumeName(storeId: string) {
  return `memory-${storeId}`
}

function memoryRefForStore(storeId: string) {
  return `ama://memories/${encodeURIComponent(storeId)}`
}

function hostingModeLabel(value: Environment['spec']['type']) {
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
          <FieldDescription>Project vaults are the default for runtime secret references.</FieldDescription>
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
