import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../env'

// The drizzle client factory. db/ is the one place outside adapters/repos that
// is allowed to construct the drizzle handle, so composition.ts wires the Deps
// object without importing drizzle directly.
export function createDb(env: Env) {
  return drizzle(env.DB)
}
