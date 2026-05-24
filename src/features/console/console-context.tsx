import { createContext, useContext } from 'react'
import type { View } from '@/console/types'
import type { Agent, AuthContext, Environment, Session, SessionEvent } from '@/lib/api'

export interface ConsoleContextValue {
  auth: AuthContext
  view: View
  query: string
  setQuery: (value: string) => void
  includeArchived: boolean
  setIncludeArchived: (value: boolean) => void
  agents: Agent[]
  environments: Environment[]
  sessions: Session[]
  selectedSession: Session | null
  selectedSessionId: string | null
  setSelectedSessionId: (value: string) => void
  sessionEvents: SessionEvent[]
  runtimeTranscript: string
  taskMessage: string
  setTaskMessage: (value: string) => void
  notice: string | null
  error: string | null
  busy: boolean
  refresh: () => void
  openCreateAgent: () => void
  openCreateEnvironment: () => void
  archiveAgent: (id: string) => void
  archiveEnvironment: (id: string) => void
  startSession: (agentId: string) => void
  stopSession: (id: string) => void
  archiveSession: (id: string) => void
  refreshEvents: () => void
  sendTask: () => void
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null)

export function ConsoleContextProvider({ value, children }: { value: ConsoleContextValue; children: React.ReactNode }) {
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
}

export function useConsoleContext() {
  const context = useContext(ConsoleContext)
  if (!context) {
    throw new Error('useConsoleContext must be used inside ConsoleContextProvider')
  }
  return context
}
