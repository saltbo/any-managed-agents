import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './select'

function stubPointerEvents() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    value: vi.fn(() => false),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  })
}

describe('Select', () => {
  it('renders a component-level empty state when no SelectItem is provided', async () => {
    stubPointerEvents()
    render(
      <Select>
        <SelectTrigger aria-label="Empty select">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>{[]}</SelectGroup>
        </SelectContent>
      </Select>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Empty select' })
    trigger.focus()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)

    expect(await screen.findByText('No options')).toBeInTheDocument()
  })

  it('renders provided items instead of the empty state', async () => {
    stubPointerEvents()
    render(
      <Select>
        <SelectTrigger aria-label="Filled select">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="one">One</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Filled select' })
    trigger.focus()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)

    expect(await screen.findByRole('option', { name: 'One' })).toBeInTheDocument()
    expect(screen.queryByText('No options')).toBeNull()
  })
})
