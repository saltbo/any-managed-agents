// The terminal outcome of a single turn run, accumulated by a pure reducer over
// the cancellation / pause / failure signals the engine observes from its
// concurrent callbacks (the stream fn and the event subscriber). This replaces
// the prior cluster of mutable boolean flags (aborted/cancelled/paused/
// failureMessage) so outcome precedence lives in one tested place instead of an
// ad-hoc if-ladder spread across callbacks.

export type TurnStatus =
  | { kind: 'idle' }
  | { kind: 'paused' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

export type TurnStatusSignal = { type: 'pause' } | { type: 'cancel' } | { type: 'fail'; message: string }

// Precedence (high → low): pause > cancel > fail > idle. A higher-precedence
// outcome already recorded is never downgraded by a later lower-precedence
// signal. 'idle' is the initial value and means "no terminal signal seen → the
// turn completed successfully".
const PRECEDENCE: Record<TurnStatus['kind'], number> = { idle: 0, failed: 1, cancelled: 2, paused: 3 }

export function reduceTurnStatus(current: TurnStatus, signal: TurnStatusSignal): TurnStatus {
  const next: TurnStatus =
    signal.type === 'pause'
      ? { kind: 'paused' }
      : signal.type === 'cancel'
        ? { kind: 'cancelled' }
        : { kind: 'failed', message: signal.message }
  if (PRECEDENCE[next.kind] > PRECEDENCE[current.kind]) {
    return next
  }
  // A later failure replaces an earlier failure's message (last-write-wins,
  // matching the original failureMessage assignment) but still cannot override a
  // higher-precedence cancel/pause already recorded.
  if (next.kind === 'failed' && current.kind === 'failed') {
    return next
  }
  return current
}
