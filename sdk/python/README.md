# Any Managed Agents Python SDK

This directory is the generated Python SDK package scaffold for the external Any Managed Agents control-plane API.

Regenerate the OpenAPI snapshot and generated operation metadata from Hono routes:

```bash
npm run openapi:generate
python -m compileall sdk/python/ama_sdk
```

This package is not an npm workspace. It uses native Python package metadata and must remain generated from or mechanically aligned with `sdk/openapi.json`.
