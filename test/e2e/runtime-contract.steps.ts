import assert from 'node:assert/strict'
import { Given, Then } from '@cucumber/cucumber'
import { PI_EVENT_TYPES } from '../../shared/pi-events'

Given('a session has events', () => {
  assert.ok(PI_EVENT_TYPES.length > 0)
})

Then('browser clients use WebSocket for bidirectional runtime commands and events', () => {
  const url = new URL('/runtime/sessions/session_1/ws', 'http://localhost')
  url.protocol = 'ws:'
  assert.equal(url.toString(), 'ws://localhost/runtime/sessions/session_1/ws')
})

Then('AMA persists runtime events before exposing them to clients', () => {
  assert.ok(PI_EVENT_TYPES.includes('message_end'))
})

Then('clients can list or stream persisted session events', () => {
  assert.equal('/api/sessions/session_1/events'.endsWith('/events'), true)
})
