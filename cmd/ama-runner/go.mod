module github.com/saltbo/any-managed-agents/cmd/ama-runner

go 1.24

require github.com/saltbo/any-managed-agents/sdk/go v0.0.0

require github.com/coder/websocket v1.8.14

replace github.com/saltbo/any-managed-agents/sdk/go => ../../sdk/go
