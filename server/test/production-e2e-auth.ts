import type { BrowserContextOptions } from '@playwright/test'

export interface ProductionE2EAuthInput {
  sessionCookie?: string | undefined
  storageState?: string | undefined
  loginEmail?: string | undefined
  loginPassword?: string | undefined
}

export interface ProductionE2EAuth {
  sessionCookie: string | undefined
  storageState: BrowserContextOptions['storageState'] | undefined
  loginEmail: string | undefined
  loginPassword: string | undefined
  hasPasswordLogin: boolean
}

export function resolveProductionE2EAuth(input: ProductionE2EAuthInput): ProductionE2EAuth {
  const sessionCookie = present(input.sessionCookie)
  const loginEmail = present(input.loginEmail)
  const loginPassword = present(input.loginPassword)

  return {
    sessionCookie,
    storageState: sessionCookie ? undefined : resolveStorageState(input.storageState),
    loginEmail,
    loginPassword,
    hasPasswordLogin: Boolean(loginEmail && loginPassword),
  }
}

function resolveStorageState(value: string | undefined): BrowserContextOptions['storageState'] | undefined {
  const storageState = present(value)
  if (!storageState) {
    return undefined
  }

  const trimmed = storageState.trim()
  if (!trimmed.startsWith('{')) {
    return storageState
  }

  try {
    return JSON.parse(trimmed) as Exclude<BrowserContextOptions['storageState'], string | undefined>
  } catch {
    throw new Error('AMA_E2E_STORAGE_STATE must be a file path or valid Playwright storage state JSON')
  }
}

function present(value: string | undefined) {
  return value?.trim() ? value : undefined
}
