# AMA SDK Facade Spec

`resources.json` is the stable public SDK shape shared by the TypeScript, Go,
and Python SDKs.

The OpenAPI document remains the HTTP contract and the source for generated
models and raw operations. This spec only names the facade resources and methods
that all SDKs expose on top of those generated operations.

Regenerate the language facades after changing this file:

```sh
pnpm run openapi:generate
```
