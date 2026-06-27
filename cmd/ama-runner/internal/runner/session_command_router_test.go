package runner

import (
	"errors"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/hostruntime"
	runtimeworkspace "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	"testing"
)

// --- sessionCommandRouter unit tests ---

func TestSessionCommandRouterBuffersPromptBeforeSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "first prompt"})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "second prompt"})

	var received []string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		received = append(received, command.Message)
		return nil
	})

	if len(received) != 2 || received[0] != "first prompt" || received[1] != "second prompt" {
		t.Fatalf("expected buffered prompts flushed on registration, got %v", received)
	}
}

func TestSessionCommandRouterDeliversPromptAfterSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})

	var received []string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		received = append(received, command.Message)
		return nil
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "live prompt"})

	if len(received) != 1 || received[0] != "live prompt" {
		t.Fatalf("expected live prompt delivered immediately, got %v", received)
	}
}

func TestSessionCommandRouterRecordsPromptAfterDelivery(t *testing.T) {
	var recorded []string
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{}, func(message string) {
		recorded = append(recorded, message)
	})

	var received []string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		received = append(received, command.Message)
		return nil
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "live prompt"})

	if len(received) != 1 || received[0] != "live prompt" {
		t.Fatalf("expected prompt delivered, got %v", received)
	}
	if len(recorded) != 1 || recorded[0] != "live prompt" {
		t.Fatalf("expected delivered prompt recorded, got %v", recorded)
	}
}

func TestSessionCommandRouterRecordsBufferedPromptAfterDelivery(t *testing.T) {
	var recorded []string
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{}, func(message string) {
		recorded = append(recorded, message)
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "buffered prompt"})

	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return nil
	})

	if len(recorded) != 1 || recorded[0] != "buffered prompt" {
		t.Fatalf("expected buffered prompt recorded after flush, got %v", recorded)
	}
}

func TestSessionCommandRouterDoesNotRecordPromptWhenDeliveryFails(t *testing.T) {
	var recorded []string
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{}, func(message string) {
		recorded = append(recorded, message)
	})
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("send failed")
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "failed prompt"})

	if len(recorded) != 0 {
		t.Fatalf("expected failed prompt not recorded, got %v", recorded)
	}
}

func TestSessionCommandRouterBuffersStopBeforeSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "abort", Reason: "timeout"})

	var received string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		received = command.Reason
		return nil
	})

	if received != "timeout" {
		t.Fatalf("expected buffered stop flushed on registration, got %q", received)
	}
}

func TestSessionCommandRouterDeliversStopAfterSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})

	var received string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		received = command.Reason
		return nil
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "abort", Reason: "user cancelled"})

	if received != "user cancelled" {
		t.Fatalf("expected live stop delivered immediately, got %q", received)
	}
}

func TestSessionCommandRouterBuffersPermissionBeforeSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	cmd := hostruntime.BridgeControlFrame{
		Type:         "permissionDecision",
		PermissionID: "perm_1",
		Allowed:      true,
		Reason:       "approved",
	}
	router.deliverControl(cmd)

	var gotID string
	var gotAllowed bool
	var gotReason string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		gotID, gotAllowed, gotReason = command.PermissionID, command.Allowed, command.Reason
		return nil
	})

	if gotID != "perm_1" || !gotAllowed || gotReason != "approved" {
		t.Fatalf("expected buffered permission flushed on registration, got id=%q allowed=%v reason=%q", gotID, gotAllowed, gotReason)
	}
}

func TestSessionCommandRouterDeliversPermissionAfterSenderRegistered(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})

	var gotID string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		gotID = command.PermissionID
		return nil
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "permissionDecision", PermissionID: "perm_2", Allowed: false, Reason: "denied"})

	if gotID != "perm_2" {
		t.Fatalf("expected live permission delivered immediately, got %q", gotID)
	}
}

func TestSessionCommandRouterBuffersAbortControlsInOrder(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "abort", Reason: "first"})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "abort", Reason: "second"})

	var received []string
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		received = append(received, command.Reason)
		return nil
	})

	if len(received) != 2 || received[0] != "first" || received[1] != "second" {
		t.Fatalf("expected abort controls flushed in order, got %v", received)
	}
}

// --- sessionCommandRouter error-path tests ---

func TestSessionCommandRouterDeliverPromptLogsWhenSendErrors(t *testing.T) {
	// deliverControl must not return the error — it logs a warning and moves on.
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("send failed")
	})
	// Must not panic or return error — just log and continue.
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "failing prompt"})
}

func TestSessionCommandRouterDeliverStopLogsWhenSendErrors(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("stop send failed")
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "abort", Reason: "abort"})
}

func TestSessionCommandRouterDeliverPermissionLogsWhenSendErrors(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("permission send failed")
	})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "permissionDecision", PermissionID: "perm_err", Allowed: true})
}

func TestSessionCommandRouterRegisterControlSenderLogsFlushError(t *testing.T) {
	// Buffer a prompt before sender is registered; flush should log the error.
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "send", Message: "buffered prompt"})
	// registerControlSender calls send for each buffered control; if it errors, log and continue.
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("flush send failed")
	})
}

func TestSessionCommandRouterRegisterAbortControlLogsFlushError(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "abort", Reason: "buffered stop"})
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("stop flush failed")
	})
}

func TestSessionCommandRouterRegisterPermissionControlLogsFlushError(t *testing.T) {
	router := newSessionCommandRouter("session_1", runtimeworkspace.Manager{})
	router.deliverControl(hostruntime.BridgeControlFrame{Type: "permissionDecision", PermissionID: "perm_flush"})
	router.registerControlSender(func(command hostruntime.BridgeControlFrame) error {
		return errors.New("permission flush failed")
	})
}
