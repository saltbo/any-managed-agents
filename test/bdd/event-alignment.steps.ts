import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Then, When } from '@cucumber/cucumber'
import { PI_EVENT_CATEGORIES, PI_EVENT_TYPES } from '../../shared/pi-events'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function assertIncludes(path: string, ...patterns: RegExp[]) {
  const source = read(path)
  for (const pattern of patterns) {
    assert.match(source, pattern, `${path} should match ${pattern}`)
  }
}

function assertAcceptedEventFixtures(path: string) {
  const source = read(path)
  for (const type of PI_EVENT_TYPES) {
    assert.match(source, new RegExp(`\\b${type}\\b`), `${path} should cover ${type}`)
  }
}

function assertSharedEventRegistry() {
  assert.ok(PI_EVENT_TYPES.length >= 16)
  assert.deepEqual([...PI_EVENT_CATEGORIES], ['message', 'tool', 'lifecycle', 'usage', 'error', 'bridge'])
  assert.equal(new Set(PI_EVENT_TYPES).size, PI_EVENT_TYPES.length)
}

When('an event type is defined', assertSharedEventRegistry)

Then('storage schema, runtime emitters, UI renderers, and docs all recognize it', () => {
  assertSharedEventRegistry()
  assertIncludes('server/app.ts', /piEventTypeFromPayload/, /type: piEventType/, /appendPiRuntimeEvent/)
  assertIncludes('server/runtime/pi/pi-bridge.mjs', /bridge_stderr/, /bridge_exit/)
  assertIncludes(
    'server/app.ts',
    /tool_execution_start/,
    /tool_execution_end/,
    /message_end/,
    /usage/,
    /agent_start/,
    /turn_start/,
    /message_start/,
    /message_update/,
    /turn_end/,
    /agent_end/,
  )
  assertIncludes('src/features/sessions/pi-runtime.ts', /piEventTypeFromPayload/, /piEventCategory/, /isPiEventType/)
  assertIncludes('src/features/sessions/SessionRuntimePanel.tsx', /piEventLabel/, /piEventCategory/, /EVENT_FILTERS/)
  assertIncludes(
    'specs/product/events-streaming.feature',
    /transcript is derived from Pi runtime events/,
    /debug shows/,
  )
  assertAcceptedEventFixtures('src/features/sessions/pi-runtime.test.ts')
  assertIncludes('src/features/sessions/sessions-ui.test.tsx', /PI_EVENT_TYPES\.map/, /PI_EVENT_CATEGORIES/)
})

When('a session event type is added', assertSharedEventRegistry)

Then('the UI badge, label, and debug metadata mapping are updated together', () => {
  assertSharedEventRegistry()
  assertIncludes('src/features/sessions/SessionRuntimePanel.tsx', /piEventLabel/, /piEventCategory/, /EVENT_FILTERS/)
  assertIncludes('src/features/sessions/sessions-ui.test.tsx', /piEventLabel/, /PI_EVENT_TYPES/, /PI_EVENT_CATEGORIES/)
})

When('event schema changes', assertSharedEventRegistry)

Then('types, storage, runtime emitters, and UI renderers are updated together', () => {
  assertSharedEventRegistry()
  assertIncludes('shared/pi-events.ts', /PI_EVENT_DEFINITIONS/, /piEventTypeFromPayload/)
  assertIncludes('server/app.ts', /piEventTypeFromPayload/, /appendPiRuntimeEvent/)
  assertIncludes('src/features/sessions/pi-runtime.ts', /PiRuntimeDebugEvent/, /PiRuntimeToolTrace/)
  assertIncludes('src/features/sessions/SessionRuntimePanel.tsx', /filteredDebugEvents/, /transcriptItems/)
  assertAcceptedEventFixtures('src/features/sessions/pi-runtime.test.ts')
  assertIncludes('src/features/sessions/sessions-ui.test.tsx', /PI_EVENT_TYPES\.map/, /PI_EVENT_CATEGORIES/)
})
