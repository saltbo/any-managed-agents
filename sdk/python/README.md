# Any Managed Agents Python SDK

This directory is the generated Python SDK package scaffold for the external Any Managed Agents control-plane API.

Regenerate the OpenAPI snapshot and generated operation metadata from Hono routes:

```bash
pnpm run openapi:generate
python -m compileall sdk/python/ama_sdk
```

This package is not a pnpm workspace. It uses native Python package metadata and must remain generated from or mechanically aligned with `sdk/openapi.json`.

Environment resources own hosting and runtime selection:

```python
client.environments.create(
    {
        "name": "Node workspace",
        "hostingMode": "cloud",
        "runtime": "ama",
        "runtimeConfig": {"image": "node:24"},
    }
)

client.agents.create(
    {
        "name": "Research assistant",
        "provider": "workers-ai",
        "model": "@cf/moonshotai/kimi-k2.6",
    }
)
```
