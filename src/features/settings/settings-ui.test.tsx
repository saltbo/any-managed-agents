import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  it('renders Providers and MCP as routed tabs', () => {
    render(
      <MemoryRouter initialEntries={['/settings/mcp']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />}>
            <Route path="providers" element={<div>Providers settings</div>} />
            <Route path="mcp" element={<div>MCP settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Providers' }).getAttribute('href')).toBe('/settings/providers')
    expect(screen.getByRole('tab', { name: 'MCP' }).getAttribute('href')).toBe('/settings/mcp')
    expect(screen.getByText('MCP settings')).toBeTruthy()
  })
})
