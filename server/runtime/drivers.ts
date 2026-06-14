// Shim: the runtime driver table is now pure domain (domain/runtime/driver).
// Re-exported here so existing runtime/adapter importers keep their import path.
export {
  isRuntimeName,
  RUNTIME_DRIVERS,
  type RuntimeDriver,
  runtimeDriver,
  runtimeDriverName,
  runtimeEndpointPath,
  runtimeMetadata,
} from '../domain/runtime/driver'
