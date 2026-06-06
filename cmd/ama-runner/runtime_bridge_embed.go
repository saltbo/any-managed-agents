package main

import _ "embed"

//go:embed runtime_bridge_bundle.mjs
var embeddedRuntimeBridge []byte
