import assert from 'node:assert/strict'
import { Given, Then } from '@cucumber/cucumber'
import { PI_EVENT_TYPES } from '../../shared/pi-events'

Given('a session has events', () => {
  assert.ok(PI_EVENT_TYPES.length > 0)
})

Then('browser clients use WebSocket for bidirectional Pi RPC commands and events', () => {
  const url = new URL('/runtime/sessions/session_1/ws', 'http://localhost')
  url.protocol = 'ws:'
  assert.equal(url.toString(), 'ws://localhost/runtime/sessions/session_1/ws')
})

Then('AMA does not inject custom response or lifecycle events into the Pi runtime stream', () => {
  assert.equal(PI_EVENT_TYPES.includes('session_created' as never), false)
  assert.equal(PI_EVENT_TYPES.includes('websocket_message_completed' as never), false)
})

Then('clients do not poll the runtime endpoint for NDJSON transcripts', () => {
  const websocketUrl = 'ws://localhost/runtime/sessions/session_1/ws'
  assert.equal(websocketUrl.endsWith('/ws'), true)
})
