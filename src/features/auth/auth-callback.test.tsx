import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

// vi.mock hoists above all imports — fixtures MUST be defined inside the factory
vi.mock('@/lib/oidc', () => ({
  completeSignIn: vi.fn(),
}))

import { completeSignIn } from '@/lib/oidc'
import { AuthCallbackPage } from './AuthCallbackPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('[spec: auth/callback] AuthCallbackPage', () => {
  it('shows completing sign-in message while the OIDC callback is in progress', () => {
    vi.mocked(completeSignIn).mockReturnValue(new Promise(() => {}))

    render(
      <MemoryRouter>
        <AuthCallbackPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Completing sign-in')).toBeTruthy()
    expect(screen.getByText('Returning from OIDC provider.')).toBeTruthy()
  })

  it('redirects to the returnTo path on successful sign-in', async () => {
    vi.mocked(completeSignIn).mockResolvedValue('/dashboard')
    const replaceSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { replace: replaceSpy },
      writable: true,
      configurable: true,
    })

    render(
      <MemoryRouter>
        <AuthCallbackPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/dashboard'))
  })

  it('shows sign-in failed message when completeSignIn rejects with an Error', async () => {
    vi.mocked(completeSignIn).mockRejectedValue(new Error('Token exchange failed'))

    render(
      <MemoryRouter>
        <AuthCallbackPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Sign-in failed')).toBeTruthy()
    expect(screen.getByText('Token exchange failed')).toBeTruthy()
  })

  it('shows generic OIDC sign-in failed message when rejection is not an Error instance', async () => {
    vi.mocked(completeSignIn).mockRejectedValue('something went wrong')

    render(
      <MemoryRouter>
        <AuthCallbackPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Sign-in failed')).toBeTruthy()
    expect(screen.getByText('OIDC sign-in failed')).toBeTruthy()
  })
})
