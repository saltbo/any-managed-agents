import { setWorldConstructor, World } from '@cucumber/cucumber'

// Step files attach their own scenario state by intersecting AmaWorld inline
// (e.g. `AmaWorld & { e2e?: E2EState }`), so the shared base carries no fields.
export class AmaWorld extends World {}

setWorldConstructor(AmaWorld)
