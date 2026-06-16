import { useQuery } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/console/components'
import { isArchived } from '@/console/format'
import { TextAreaField, TextField } from '@/console/forms'
import { api, type Connector, type Environment } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import {
  AGENT_TEMPLATES,
  type AgentBuilderDraft,
  type AgentTemplate,
  BUILDER_STEP_TITLES,
  BUILDER_STEPS,
  type BuilderFieldErrors,
  type BuilderStep,
} from './agent-builder-model'

export interface StepProps {
  draft: AgentBuilderDraft
  errors: BuilderFieldErrors
  setField: <K extends keyof AgentBuilderDraft>(field: K, value: AgentBuilderDraft[K]) => void
}

export function BuilderStepper({ current, published }: { current: BuilderStep; published: boolean }) {
  const steps = BUILDER_STEPS.filter((step) => step !== 'done' || published)
  return (
    <nav aria-label="Builder steps" className="flex flex-wrap gap-2">
      {steps.map((step, index) => (
        <Link
          key={step}
          to={`/agents/new?step=${step}`}
          aria-current={step === current ? 'step' : undefined}
          className={cn(buttonVariants({ variant: step === current ? 'default' : 'outline', size: 'sm' }), 'shrink-0')}
        >
          {index + 1}. {BUILDER_STEP_TITLES[step]}
        </Link>
      ))}
    </nav>
  )
}

export function StartStep({
  goal,
  setGoal,
  onDraftFromGoal,
  onUseTemplate,
  onSkip,
}: {
  goal: string
  setGoal: (value: string) => void
  onDraftFromGoal: () => void
  onUseTemplate: (template: AgentTemplate) => void
  onSkip: () => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="builder-goal">Agent goal</FieldLabel>
        <Textarea
          id="builder-goal"
          value={goal}
          placeholder="Review incoming pull requests and summarize risky changes."
          onChange={(event) => setGoal(event.target.value)}
        />
        <FieldDescription>
          Describe what this agent should do. The builder drafts the name, instructions, model choice, tool policy, and
          MCP connectors. You review one decision at a time and can edit everything before saving.
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!goal.trim()} onClick={onDraftFromGoal}>
          <Wand2 data-icon="inline-start" />
          Draft agent configuration
        </Button>
        <Button type="button" variant="outline" onClick={onSkip}>
          Start from scratch
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {AGENT_TEMPLATES.map((template) => (
          <Card key={template.id} className="gap-3">
            <CardHeader>
              <CardTitle className="text-base">{template.name}</CardTitle>
              <CardDescription>{template.summary}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" size="sm" onClick={() => onUseTemplate(template)}>
                Use template
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function CoreStep({ draft, errors, setField }: StepProps) {
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.models,
    queryFn: () => api.listModels(),
  })
  const models = (modelsQuery.data?.data ?? []).filter((model) => model.availability === 'available')
  const selectedModelKey = draft.model ? `${draft.provider}::${draft.model}` : ''
  const hasSelected = models.some((model) => model.providerId === draft.provider && model.modelId === draft.model)
  return (
    <div className="grid gap-4">
      <TextField label="Name" value={draft.name} onChange={(value) => setField('name', value)} error={errors.name} />
      <TextField
        label="Description"
        description="Optional summary shown in agent lists."
        value={draft.description}
        onChange={(value) => setField('description', value)}
        error={errors.description}
      />
      <TextAreaField
        label="Instructions"
        description="Operational instructions the agent follows in every session."
        value={draft.instructions}
        onChange={(value) => setField('instructions', value)}
        error={errors.instructions}
      />
      <Field data-invalid={errors.model || errors.provider ? true : undefined}>
        <FieldLabel htmlFor="builder-model">Model</FieldLabel>
        <Select
          {...(selectedModelKey ? { value: selectedModelKey } : {})}
          onValueChange={(key) => {
            const [provider, ...rest] = key.split('::')
            setField('provider', provider ?? '')
            setField('model', rest.join('::'))
          }}
        >
          <SelectTrigger id="builder-model">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {models.map((model) => (
                <SelectItem
                  key={`${model.providerId}::${model.modelId}`}
                  value={`${model.providerId}::${model.modelId}`}
                >
                  {model.displayName || model.modelId} ({model.providerId})
                </SelectItem>
              ))}
              {draft.model && !hasSelected ? (
                <SelectItem value={selectedModelKey}>
                  {draft.model} ({draft.provider})
                </SelectItem>
              ) : null}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Models come from the global vendor catalog. Picking one pins both the vendor and the model.
        </FieldDescription>
        {errors.provider ? <FieldError>{errors.provider}</FieldError> : null}
        {errors.model ? <FieldError>{errors.model}</FieldError> : null}
      </Field>
    </div>
  )
}

export function ToolsStep({ draft, errors, setField, connectors }: StepProps & { connectors: Connector[] }) {
  const toggleConnector = (connectorId: string, include: boolean) => {
    const next = draft.mcpConnectors.filter((id) => id !== connectorId)
    setField('mcpConnectors', include ? [...next, connectorId] : next)
  }
  return (
    <div className="grid gap-4">
      <TextAreaField
        label="Allowed tools"
        description="One runtime tool name per line. Policy-blocked tools are rejected when the agent is saved."
        value={draft.allowedTools}
        onChange={(value) => setField('allowedTools', value)}
        error={errors.allowedTools}
      />
      <Field data-invalid={errors.mcpConnectors ? true : undefined}>
        <FieldLabel>MCP connectors</FieldLabel>
        <FieldDescription>
          Connectors expose their tool schemas, approval mode, and project policy status. Only connected connectors can
          be attached to an agent.
        </FieldDescription>
        <div className="grid gap-3">
          {connectors.map((connector) => (
            <ConnectorOption
              key={connector.id}
              connector={connector}
              selected={draft.mcpConnectors.includes(connector.id)}
              onToggle={(include) => toggleConnector(connector.id, include)}
            />
          ))}
          {connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP connectors are available in the catalog.</p>
          ) : null}
        </div>
        {errors.mcpConnectors ? <FieldError>{errors.mcpConnectors}</FieldError> : null}
      </Field>
    </div>
  )
}

function ConnectorOption({
  connector,
  selected,
  onToggle,
}: {
  connector: Connector
  selected: boolean
  onToggle: (include: boolean) => void
}) {
  const connectable = connector.availability === 'available'
  const checkboxId = `builder-connector-${connector.id}`
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={selected}
          disabled={!connectable}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        <label htmlFor={checkboxId} className="text-sm font-medium">
          {connector.name}
        </label>
        <StatusBadge value={connector.availability} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{connector.description}</p>
      <ul className="mt-2 grid gap-2">
        {connector.tools.map((tool) => (
          <li key={tool.name} className="rounded-md bg-muted/40 px-2 py-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{tool.name}</span>
              <span className="text-muted-foreground">Approval mode: {tool.approvalMode}</span>
            </div>
            {tool.description ? <p className="mt-0.5 text-muted-foreground">{tool.description}</p> : null}
            {tool.inputSchema ? (
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                Schema: {JSON.stringify(tool.inputSchema)}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SandboxStep({ draft, errors, setField }: StepProps) {
  return (
    <div className="grid gap-4">
      <Field orientation="horizontal">
        <Checkbox
          id="builder-sandbox-enabled"
          checked={draft.sandboxEnabled}
          onCheckedChange={(checked) => setField('sandboxEnabled', checked === true)}
        />
        <FieldLabel htmlFor="builder-sandbox-enabled">Enable sandbox execution</FieldLabel>
      </Field>
      <FieldDescription>
        Sessions created from this agent can request Cloudflare Sandbox execution through a cloud environment. Carried
        skills are mounted into the sandbox workspace.
      </FieldDescription>
      {draft.sandboxEnabled ? (
        <TextAreaField
          label="Carried skills"
          description="One stable skill reference per line, such as source@skill."
          value={draft.skills}
          onChange={(value) => setField('skills', value)}
          error={errors.skills}
        />
      ) : null}
    </div>
  )
}

export function RolesStep({ draft, errors, setField }: StepProps) {
  return (
    <div className="grid gap-4">
      <TextField
        label="Role"
        description="Optional durable responsibility, such as maintainer or worker. Products define their own role names."
        value={draft.role}
        onChange={(value) => setField('role', value)}
        error={errors.role}
      />
      <TextAreaField
        label="Capability tags"
        description="One stable capability identifier per line, such as implementation or code-review."
        value={draft.capabilityTags}
        onChange={(value) => setField('capabilityTags', value)}
        error={errors.capabilityTags}
      />
      <TextAreaField
        label="Handoff targets"
        description="One target per line as role=<role> or capability=<capability>. AMA resolves matching agents inside this project; the requesting product decides what a handoff means for its own workflow."
        value={draft.handoffTargets}
        onChange={(value) => setField('handoffTargets', value)}
        error={errors.handoffTargets}
      />
      <Field orientation="horizontal" data-invalid={errors.memoryEnabled ? true : undefined}>
        <Checkbox
          id="builder-memory-enabled"
          checked={draft.memoryEnabled}
          onCheckedChange={(checked) => setField('memoryEnabled', checked === true)}
        />
        <FieldLabel htmlFor="builder-memory-enabled">Enable project-scoped agent memory</FieldLabel>
      </Field>
      <FieldDescription>
        Enabled memory exposes the generic agent memory API for long-running agents. Worker-style agents can leave
        memory disabled.
      </FieldDescription>
      {errors.memoryEnabled ? <FieldError>{errors.memoryEnabled}</FieldError> : null}
    </div>
  )
}

export function TestEnvironmentField({
  environments,
  environmentId,
  setEnvironmentId,
}: {
  environments: Environment[]
  environmentId: string
  setEnvironmentId: (value: string) => void
}) {
  const activeEnvironments = environments.filter((environment) => !isArchived(environment))
  return (
    <Field>
      <FieldLabel>Test environment</FieldLabel>
      <Select value={environmentId} onValueChange={setEnvironmentId}>
        <SelectTrigger aria-label="Test environment">
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
        {activeEnvironments.length === 0 ? (
          <>
            No active environments.{' '}
            <Link className="underline" to="/environments">
              Create one on the Environments page
            </Link>{' '}
            before testing.
          </>
        ) : (
          'The draft test session runs against this environment.'
        )}
      </FieldDescription>
    </Field>
  )
}
