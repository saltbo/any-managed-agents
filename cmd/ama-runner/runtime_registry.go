package main

import (
	"context"
	"fmt"
)

type sessionRuntimeExecution struct {
	RequestContext context.Context
	LeaseContext   context.Context
	Channel        RunnerSessionChannel
	Lease          *Lease
	Payload        WorkPayload
	CheckRenewal   func() error
	// ResumeTokens carries the latest runtime resume token from the runtime
	// adapter to lease renewals and the interrupted finalization.
	ResumeTokens *resumeTokenBox
}

type sessionRuntimeHandler struct {
	acknowledgeSessionStarted bool
	run                       func(*RunnerDaemon, sessionRuntimeExecution) error
}

func sessionRuntimeHandlers() map[string]sessionRuntimeHandler {
	return map[string]sessionRuntimeHandler{
		// AMA now runs the shared runtime-core turn engine inside the embedded
		// runtime-bridge subprocess (the same engine the cloud runs), so it goes
		// through the external-session path like the other bridge runtimes.
		"ama": {
			acknowledgeSessionStarted: true,
			run: func(d *RunnerDaemon, execution sessionRuntimeExecution) error {
				return d.runExternalSession(execution)
			},
		},
		"codex": {
			acknowledgeSessionStarted: true,
			run: func(d *RunnerDaemon, execution sessionRuntimeExecution) error {
				return d.runExternalSession(execution)
			},
		},
		"claude-code": {
			acknowledgeSessionStarted: true,
			run: func(d *RunnerDaemon, execution sessionRuntimeExecution) error {
				return d.runExternalSession(execution)
			},
		},
		"copilot": {
			acknowledgeSessionStarted: true,
			run: func(d *RunnerDaemon, execution sessionRuntimeExecution) error {
				return d.runExternalSession(execution)
			},
		},
	}
}

func sessionRuntimeHandlerFor(runtimeName string) (sessionRuntimeHandler, error) {
	handler, ok := sessionRuntimeHandlers()[runtimeName]
	if !ok {
		return sessionRuntimeHandler{}, fmt.Errorf("unsupported session runtime %q", runtimeName)
	}
	return handler, nil
}
