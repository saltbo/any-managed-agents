module github.com/saltbo/any-managed-agents/cmd/ama-runner

go 1.24.0

require github.com/saltbo/any-managed-agents/sdk/go v0.0.0

require (
	github.com/coder/websocket v1.8.14
	github.com/samber/lo v1.53.0
)

require (
	github.com/apapsch/go-jsonmerge/v2 v2.0.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/oapi-codegen/runtime v1.4.1 // indirect
	golang.org/x/text v0.32.0 // indirect
)

replace github.com/saltbo/any-managed-agents/sdk/go => ../../sdk/go
