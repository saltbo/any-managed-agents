import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AgentForm, EnvironmentForm, ProviderForm, SessionForm, VaultForm } from '@/console/forms'
import type {
  AgentFormState,
  CreateMode,
  EnvironmentFormState,
  ProviderFormState,
  SessionFormState,
  VaultFormState,
} from '@/console/types'
import type { Agent, Environment } from '@/lib/api'

export interface CreateResourceSheetProps {
  mode: CreateMode
  onOpenChange: (open: boolean) => void
  environmentForm: EnvironmentFormState
  setEnvironmentForm: Dispatch<SetStateAction<EnvironmentFormState>>
  agentForm: AgentFormState
  setAgentForm: Dispatch<SetStateAction<AgentFormState>>
  sessionForm: SessionFormState
  setSessionForm: Dispatch<SetStateAction<SessionFormState>>
  providerForm: ProviderFormState
  setProviderForm: Dispatch<SetStateAction<ProviderFormState>>
  vaultForm: VaultFormState
  setVaultForm: Dispatch<SetStateAction<VaultFormState>>
  agents: Agent[]
  environments: Environment[]
  submitEnvironment: (event: FormEvent) => void
  submitAgent: (event: FormEvent) => void
  submitSession: (event: FormEvent) => void
  submitProvider: (event: FormEvent) => void
  submitVault: (event: FormEvent) => void
}

export function CreateResourceSheet(props: CreateResourceSheetProps) {
  const copy = createSheetCopy(props.mode)
  return (
    <Sheet open={props.mode !== null} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {props.mode === 'environment' ? (
            <EnvironmentForm
              value={props.environmentForm}
              setValue={props.setEnvironmentForm}
              onSubmit={props.submitEnvironment}
            />
          ) : null}
          {props.mode === 'agent' ? (
            <AgentForm value={props.agentForm} setValue={props.setAgentForm} onSubmit={props.submitAgent} />
          ) : null}
          {props.mode === 'session' ? (
            <SessionForm
              value={props.sessionForm}
              setValue={props.setSessionForm}
              agents={props.agents}
              environments={props.environments}
              onSubmit={props.submitSession}
            />
          ) : null}
          {props.mode === 'provider' ? (
            <ProviderForm value={props.providerForm} setValue={props.setProviderForm} onSubmit={props.submitProvider} />
          ) : null}
          {props.mode === 'vault' ? (
            <VaultForm value={props.vaultForm} setValue={props.setVaultForm} onSubmit={props.submitVault} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function createSheetCopy(mode: CreateMode) {
  if (mode === 'environment') {
    return {
      title: 'Create Environment',
      description: 'Define a reusable runtime environment for future sessions.',
    }
  }
  if (mode === 'provider') {
    return {
      title: 'Create Provider',
      description: 'Register a model provider without exposing raw credentials.',
    }
  }
  if (mode === 'vault') {
    return {
      title: 'Create Vault',
      description: 'Create safe credential-reference metadata for runtime integrations.',
    }
  }
  if (mode === 'session') {
    return {
      title: 'Create Session',
      description: 'Select the agent and runtime environment for this session.',
    }
  }
  return {
    title: 'Create Agent',
    description: 'Define a reusable agent profile. Runtime environments are selected when creating sessions.',
  }
}
