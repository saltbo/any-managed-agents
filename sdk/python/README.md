# Any Managed Agents Python SDK

This directory is the Python SDK package for the external Any Managed Agents
control-plane API.

The generated `ama_sdk.api` and `ama_sdk.models` modules come from
`sdk/openapi.json`. `ama_sdk.facade` is generated from
`sdk/spec/resources.json`, the shared SDK shape used by the TypeScript, Go, and
Python SDKs.

Regenerate generated operation metadata from the route-generated OpenAPI document:

```bash
pnpm run openapi:generate
python -m compileall sdk/python/ama_sdk
```

This package is not a pnpm workspace. It uses native Python package metadata and must remain generated from or mechanically aligned with `sdk/openapi.json` and `sdk/spec/resources.json`.
The canonical OpenAPI snapshot is `sdk/openapi.json`; this directory does not
carry its own OpenAPI copy.

Usage:

```python
from ama_sdk import create_ama_client
from ama_sdk.models.create_project_request import CreateProjectRequest

client = create_ama_client(
    base_url="https://ama.example.com",
    access_token=access_token,
    project_id=project_id,
)

project = client.projects.create(CreateProjectRequest(name="Control Plane"))
```
