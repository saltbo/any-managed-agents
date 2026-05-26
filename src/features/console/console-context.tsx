import { createContext, useContext } from 'react'
import type { AuthContext } from '@/lib/api'

export interface ConsoleContextValue {
  auth: AuthContext
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
