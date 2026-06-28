import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const OPENAPI_PATH = path.join(ROOT, 'sdk/openapi.json')
const SPEC_PATH = path.join(ROOT, 'sdk/spec/resources.json')

const openapi = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'))
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
const operations = collectOperations(openapi)
const pythonModules = collectPythonModules(path.join(ROOT, 'sdk/python/ama_sdk/api'))

validateSpec()
writeFileSync(path.join(ROOT, 'sdk/typescript/src/client.ts'), generateTypeScriptClient())
writeFileSync(path.join(ROOT, 'sdk/go/ama/client.go'), generateGoClient())
writeFileSync(path.join(ROOT, 'sdk/python/ama_sdk/facade.py'), generatePythonFacade())
writeFileSync(
  path.join(ROOT, 'sdk/python/ama_sdk/__init__.py'),
  `"""A client library for accessing Any Managed Agents API."""\n\nfrom .client import AuthenticatedClient, Client\nfrom .facade import AmaApiError, AmaClient, create_ama_client\n\n__all__ = (\n    "AuthenticatedClient",\n    "Client",\n    "AmaApiError",\n    "AmaClient",\n    "create_ama_client",\n)\n`,
)

execFileSync('gofmt', ['-w', 'sdk/go/ama/client.go'], { cwd: ROOT, stdio: 'inherit' })

function collectOperations(document) {
  const result = new Map()
  for (const [operationPath, methods] of Object.entries(document.paths)) {
    for (const [httpMethod, operation] of Object.entries(methods)) {
      if (!operation.operationId) continue
      const parameters = operation.parameters ?? []
      const pathParams = parameters.filter((param) => param.in === 'path')
      const queryParams = parameters.filter((param) => param.in === 'query')
      const bodyType = requestBodyType(operation)
      const success = successResponse(operation)
      result.set(operation.operationId, {
        id: operation.operationId,
        path: operationPath,
        method: httpMethod,
        tag: operation.tags?.[0] ?? 'default',
        pathParams,
        queryParams,
        bodyType,
        success,
        errorStatuses: Object.keys(operation.responses ?? {}).filter((status) => Number(status) >= 400),
      })
    }
  }
  return result
}

function requestBodyType(operation) {
  const schema = operation.requestBody?.content?.['application/json']?.schema
  return schemaRefName(schema)
}

function successResponse(operation) {
  const entries = Object.entries(operation.responses ?? {})
    .filter(([status]) => Number(status) >= 200 && Number(status) < 300)
    .sort(([a], [b]) => Number(a) - Number(b))
  const withBody = entries.find(([, response]) => schemaRefName(response.content?.['application/json']?.schema))
  if (withBody) {
    return {
      status: withBody[0],
      type: schemaRefName(withBody[1].content?.['application/json']?.schema),
      field: `JSON${withBody[0]}`,
      empty: false,
    }
  }
  const empty = entries[0]
  if (!empty) throw new Error(`Operation ${operation.operationId} has no 2xx response`)
  return { status: empty[0], type: undefined, field: undefined, empty: true }
}

function schemaRefName(schema) {
  const ref = schema?.$ref
  return ref ? ref.split('/').at(-1) : undefined
}

function validateSpec() {
  const covered = new Set()
  for (const resource of spec.resources) {
    for (const method of resource.methods) {
      if (!operations.has(method.operationId)) {
        throw new Error(`SDK spec references missing operationId: ${method.operationId}`)
      }
      if (covered.has(method.operationId)) {
        throw new Error(`SDK spec references operationId twice: ${method.operationId}`)
      }
      covered.add(method.operationId)
    }
  }
  const missing = [...operations.keys()].filter((operationId) => !covered.has(operationId)).sort()
  if (missing.length > 0) {
    throw new Error(`SDK spec does not cover OpenAPI operations:\n${missing.join('\n')}`)
  }
}

function generateTypeScriptClient() {
  const resources = spec.resources.map((resource) => generateTypeScriptResource(resource)).join(',\n\n')
  return `// Stable facade generated from sdk/spec/resources.json.\n// The generated OpenAPI layer owns HTTP shapes; this file owns public SDK shape.\n\nimport { createClient, createConfig } from './generated/client/index.js'\nimport * as ops from './generated/sdk.gen.js'\nimport type * as types from './generated/types.gen.js'\n\nexport interface AmaClientConfig {\n  baseUrl: string\n  accessToken?: string\n  projectId?: string\n  headers?: Record<string, string>\n}\n\nexport class AmaApiError extends Error {\n  constructor(\n    readonly status: number | undefined,\n    readonly responseText: string,\n    readonly body: unknown,\n  ) {\n    super(\`AMA API request failed\${status === undefined ? '' : \` with HTTP \${status}\`}\`)\n    this.name = 'AmaApiError'\n  }\n}\n\nasync function unwrap<TData>(call: Promise<{ data: TData | undefined; error?: unknown; response?: Response }>): Promise<TData> {\n  const { data, error, response } = await call\n  if (response?.ok && error === undefined) {\n    return data as TData\n  }\n  const body = error ?? data\n  throw new AmaApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body)\n}\n\nexport type AmaClient = ReturnType<typeof createAmaClient>\n\nexport function createAmaClient(config: AmaClientConfig) {\n  const client = createClient(\n    createConfig({\n      baseUrl: config.baseUrl,\n      headers: {\n        ...(config.accessToken ? { authorization: \`Bearer \${config.accessToken}\` } : {}),\n        ...(config.projectId ? { 'x-ama-project-id': config.projectId } : {}),\n        ...config.headers,\n      },\n    }),\n  )\n\n  return {\n    raw: client,\n\n${indent(resources, 4)},\n  }\n}\n`
}

function generateTypeScriptResource(resource) {
  const methods = resource.methods.map((method) => generateTypeScriptMethod(method)).join(',\n')
  return `${resource.name}: {\n${indent(methods, 2)},\n}`
}

function generateTypeScriptMethod(method) {
  const operation = operations.get(method.operationId)
  const pathParams = operation.pathParams.map((param) => `${param.name}: ${tsScalarType(param.schema)}`)
  const queryParam = operation.queryParams.length > 0 ? `query?: types.${pascal(operation.id)}Data['query']` : undefined
  const bodyParam = operation.bodyType ? `body: types.${operation.bodyType}` : undefined
  const optionsParam = operation.id === 'createTriggerRun' ? 'options?: { headers?: Record<string, string> }' : undefined
  const params = [...pathParams, bodyParam, queryParam, optionsParam].filter(Boolean).join(', ')
  const callParts = ['client']
  if (operation.pathParams.length > 0) {
    callParts.push(`path: { ${operation.pathParams.map((param) => param.name).join(', ')} }`)
  }
  if (operation.queryParams.length > 0) {
    callParts.push('query')
  }
  if (operation.bodyType) {
    callParts.push('body')
  }
  if (operation.id === 'createTriggerRun') {
    callParts.push('headers: options?.headers')
  }
  return `${method.name}: (${params}) => unwrap(ops.${operation.id}({ ${callParts.join(', ')} }))`
}

function tsScalarType(schema) {
  return schema?.type === 'integer' || schema?.type === 'number' ? 'number' : 'string'
}

function generateGoClient() {
  const fields = spec.resources.map((resource) => `\t${goResourceName(resource.name)} ${goServiceName(resource.name)}`).join('\n')
  const assignments = spec.resources
    .map((resource) => `\tclient.${goResourceName(resource.name)} = ${goServiceName(resource.name)}{client: client}`)
    .join('\n')
  const services = spec.resources.map((resource) => generateGoService(resource)).join('\n')
  return `package ama\n\nimport (\n\t\"context\"\n\t\"errors\"\n\t\"fmt\"\n\t\"net/http\"\n\t\"strings\"\n)\n\n// Regenerate the typed models and REST client (ama.gen.go) from the OpenAPI doc.\n// Requires oapi-codegen on PATH:\n//   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest\n// The config's paths (overlay, output) resolve from sdk/go, so run from there.\n// \`go generate\` invokes this from the package dir, hence the \`cd ..\`.\n//go:generate sh -c \"cd .. && oapi-codegen -config oapi-codegen.config.yaml ../openapi.json\"\n\ntype JSON = map[string]interface{}\n\ntype ClientConfig struct {\n\tBaseURL     string\n\tAccessToken string\n\tProjectID   string\n\tHeaders     map[string]string\n\tHTTPClient  HttpRequestDoer\n}\n\ntype Client struct {\n\traw *ClientWithResponses\n${fields}\n}\n\nfunc New(config ClientConfig) (*Client, error) {\n\tif strings.TrimSpace(config.BaseURL) == \"\" {\n\t\treturn nil, fmt.Errorf(\"AMA base URL is required\")\n\t}\n\topts := []ClientOption{\n\t\tWithRequestEditorFn(func(_ context.Context, request *http.Request) error {\n\t\t\tif config.AccessToken != \"\" {\n\t\t\t\trequest.Header.Set(\"authorization\", \"Bearer \"+config.AccessToken)\n\t\t\t}\n\t\t\tif config.ProjectID != \"\" {\n\t\t\t\trequest.Header.Set(\"x-ama-project-id\", config.ProjectID)\n\t\t\t}\n\t\t\tfor key, value := range config.Headers {\n\t\t\t\trequest.Header.Set(key, value)\n\t\t\t}\n\t\t\treturn nil\n\t\t}),\n\t}\n\tif config.HTTPClient != nil {\n\t\topts = append(opts, WithHTTPClient(config.HTTPClient))\n\t}\n\traw, err := NewClientWithResponses(strings.TrimRight(config.BaseURL, \"/\"), opts...)\n\tif err != nil {\n\t\treturn nil, err\n\t}\n\tclient := &Client{raw: raw}\n${assignments}\n\treturn client, nil\n}\n\nfunc (c *Client) Raw() *ClientWithResponses {\n\treturn c.raw\n}\n\ntype APIError struct {\n\tStatus       int\n\tResponseText string\n\tBody         any\n}\n\nfunc (e *APIError) Error() string {\n\tif e.Status == 0 {\n\t\treturn \"AMA API request failed\"\n\t}\n\tif e.ResponseText != \"\" {\n\t\treturn fmt.Sprintf(\"AMA API request failed with HTTP %d: %s\", e.Status, e.ResponseText)\n\t}\n\treturn fmt.Sprintf(\"AMA API request failed with HTTP %d\", e.Status)\n}\n\nfunc StatusCode(err error) (int, bool) {\n\tvar apiErr *APIError\n\tif errors.As(err, &apiErr) {\n\t\treturn apiErr.Status, true\n\t}\n\treturn 0, false\n}\n\n${services}\nfunc unwrap[T any](status int, responseBody []byte, data *T, errors ...*ErrorResponse) (*T, error) {\n\tif status >= 200 && status <= 299 && data != nil {\n\t\treturn data, nil\n\t}\n\treturn nil, newAPIError(status, responseBody, firstError(errors...))\n}\n\nfunc unwrapEmpty(status int, responseBody []byte, errors ...*ErrorResponse) error {\n\tif status >= 200 && status <= 299 {\n\t\treturn nil\n\t}\n\treturn newAPIError(status, responseBody, firstError(errors...))\n}\n\nfunc newAPIError(status int, responseBody []byte, response *ErrorResponse) *APIError {\n\tif response != nil {\n\t\treturn &APIError{Status: status, ResponseText: errorResponseText(response), Body: response}\n\t}\n\treturn &APIError{Status: status, ResponseText: strings.TrimSpace(string(responseBody)), Body: string(responseBody)}\n}\n\nfunc errorResponseText(response *ErrorResponse) string {\n\tif response == nil {\n\t\treturn \"\"\n\t}\n\tif response.Error.Message != \"\" {\n\t\treturn response.Error.Message\n\t}\n\treturn fmt.Sprintf(\"%v\", response.Error)\n}\n\nfunc firstError(errors ...*ErrorResponse) *ErrorResponse {\n\tfor _, err := range errors {\n\t\tif err != nil {\n\t\t\treturn err\n\t\t}\n\t}\n\treturn nil\n}\n`
}

function generateGoService(resource) {
  const serviceName = goServiceName(resource.name)
  const methods = resource.methods.map((method) => generateGoMethod(serviceName, method)).join('\n')
  return `type ${serviceName} struct {\n\tclient *Client\n}\n\n${methods}\n`
}

function generateGoMethod(serviceName, method) {
  const operation = operations.get(method.operationId)
  const rawName = `${pascal(operation.id)}WithResponse`
  const pathArgs = operation.pathParams.map((param) => `${goParamName(param.name)} ${goScalarType(param.schema)}`)
  const queryArg = operation.queryParams.length > 0 ? `params *${pascal(operation.id)}Params` : undefined
  const bodyArg = operation.bodyType ? `body ${operation.bodyType}` : undefined
  const args = ['ctx context.Context', ...pathArgs, queryArg, bodyArg].filter(Boolean).join(', ')
  const rawArgs = ['ctx', ...operation.pathParams.map((param) => goParamName(param.name))]
  if (operation.queryParams.length > 0) rawArgs.push('params')
  if (operation.bodyType) rawArgs.push('body')
  const errors = operation.errorStatuses.map((status) => `response.JSON${status}`).join(', ')
  const returnType = operation.success.empty ? 'error' : `(*${operation.success.type}, error)`
  const success = operation.success.empty
    ? `return unwrapEmpty(response.StatusCode(), response.Body${errors ? `, ${errors}` : ''})`
    : `return unwrap(response.StatusCode(), response.Body, response.${operation.success.field}${errors ? `, ${errors}` : ''})`
  return `func (s ${serviceName}) ${pascal(method.name)}(${args}) ${returnType} {\n\tresponse, err := s.client.raw.${rawName}(${rawArgs.join(', ')})\n\tif err != nil {\n\t\t${operation.success.empty ? 'return err' : 'return nil, err'}\n\t}\n\t${success}\n}\n`
}

function goResourceName(name) {
  return pascal(name).replace(/Id/g, 'ID')
}

function goServiceName(name) {
  return `${goResourceName(name)}Service`
}

function goParamName(name) {
  return name.replace(/Id$/, 'ID')
}

function goScalarType(schema) {
  return schema?.type === 'integer' ? 'int' : 'string'
}

function generatePythonFacade() {
  const imports = []
  for (const resource of spec.resources) {
    for (const method of resource.methods) {
      const operation = operations.get(method.operationId)
      const module = pythonModules.get(operation.id)
      if (!module) throw new Error(`Missing generated Python module for ${operation.id}`)
      imports.push(`from .api.${module.package} import ${module.name} as ${pythonModuleAlias(operation.id)}`)
    }
  }
  const resources = spec.resources.map((resource) => generatePythonResource(resource)).join('\n\n')
  const initAssignments = spec.resources.map((resource) => `        self.${pythonName(resource.name)} = _${pascal(resource.name)}Resource(self._client)`).join('\n')
  return `from __future__ import annotations\n\nfrom typing import Any\n\nfrom .client import AuthenticatedClient, Client\n${imports.sort().join('\n')}\n\n\nclass AmaApiError(Exception):\n    def __init__(self, status: int | None, response_text: str, body: Any) -> None:\n        super().__init__(f\"AMA API request failed{'' if status is None else f' with HTTP {status}'}\")\n        self.status = status\n        self.response_text = response_text\n        self.body = body\n\n\nclass AmaClient:\n    def __init__(\n        self,\n        base_url: str,\n        access_token: str | None = None,\n        project_id: str | None = None,\n        headers: dict[str, str] | None = None,\n        client: AuthenticatedClient | Client | None = None,\n    ) -> None:\n        merged_headers = dict(headers or {})\n        if project_id:\n            merged_headers[\"x-ama-project-id\"] = project_id\n        self._client = client or _new_generated_client(base_url, access_token, merged_headers)\n${initAssignments}\n\n    @property\n    def raw(self) -> AuthenticatedClient | Client:\n        return self._client\n\n\ndef create_ama_client(\n    base_url: str,\n    access_token: str | None = None,\n    project_id: str | None = None,\n    headers: dict[str, str] | None = None,\n) -> AmaClient:\n    return AmaClient(base_url=base_url, access_token=access_token, project_id=project_id, headers=headers)\n\n\ndef _new_generated_client(base_url: str, access_token: str | None, headers: dict[str, str]) -> AuthenticatedClient | Client:\n    if access_token:\n        return AuthenticatedClient(base_url=base_url, token=access_token, headers=headers)\n    return Client(base_url=base_url, headers=headers)\n\n\ndef _unwrap(response: Any) -> Any:\n    status = int(response.status_code)\n    if 200 <= status <= 299:\n        return response.parsed\n    body = response.parsed\n    response_text = getattr(body, \"error\", None)\n    if response_text is not None and getattr(response_text, \"message\", None):\n        text = response_text.message\n    else:\n        text = response.content.decode(\"utf-8\", errors=\"replace\") if response.content else \"\"\n    raise AmaApiError(status, text, body)\n\n\n${resources}\n`
}

function generatePythonResource(resource) {
  const methods = resource.methods.map((method) => generatePythonMethod(method)).join('\n\n')
  return `class _${pascal(resource.name)}Resource:\n    def __init__(self, client: AuthenticatedClient | Client) -> None:\n        self._client = client\n\n${indent(methods, 4)}`
}

function generatePythonMethod(method) {
  const operation = operations.get(method.operationId)
  const moduleAlias = pythonModuleAlias(operation.id)
  const pathArgs = operation.pathParams.map((param) => `${pythonName(param.name)}: ${pythonScalarType(param.schema)}`)
  const queryArg = operation.queryParams.length > 0 ? '**query: Any' : undefined
  const bodyArg = operation.bodyType ? 'body: Any' : undefined
  const args = ['self', ...pathArgs, bodyArg, queryArg].filter(Boolean).join(', ')
  const callArgs = operation.pathParams.map((param) => `${pythonName(param.name)}=${pythonName(param.name)}`)
  callArgs.push('client=self._client')
  if (operation.bodyType) callArgs.push('body=body')
  if (operation.queryParams.length > 0) callArgs.push('**query')
  return `def ${pythonName(method.name)}(${args}) -> Any:\n    return _unwrap(${moduleAlias}.sync_detailed(${callArgs.join(', ')}))`
}

function collectPythonModules(apiDir) {
  const result = new Map()
  for (const packageName of readdirSync(apiDir)) {
    const packageDir = path.join(apiDir, packageName)
    if (!existsSync(path.join(packageDir, '__init__.py'))) continue
    for (const fileName of readdirSync(packageDir)) {
      if (!fileName.endsWith('.py') || fileName === '__init__.py') continue
      const operationId = camel(fileName.slice(0, -3))
      result.set(operationId, { package: packageName, name: fileName.slice(0, -3) })
    }
  }
  return result
}

function pythonModuleAlias(operationId) {
  return `${pythonName(operationId)}_api`
}

function pythonName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

function pythonScalarType(schema) {
  return schema?.type === 'integer' ? 'int' : 'str'
}

function pascal(value) {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/(?:^|\s)([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/\s/g, '')
}

function camel(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function indent(value, spaces) {
  const padding = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => (line ? `${padding}${line}` : line))
    .join('\n')
}
