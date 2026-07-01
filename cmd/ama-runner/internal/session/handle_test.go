package session

import (
	"errors"
	"testing"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
)

func rawControl(value string) runtime.BridgeControlFrame {
	return runtime.BridgeControlFrame(value)
}

func TestHostHandleBuffersOpaqueCommandsBeforeSenderRegistered(t *testing.T) {
	router := NewHostHandle("session_1")
	router.deliverControl(rawControl(`{"type":"send","message":"first prompt"}`))
	router.deliverControl(rawControl(`{"type":"permissionDecision","permissionId":"perm_1","allowed":true}`))

	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, string(command))
		return nil
	})

	if len(received) != 2 {
		t.Fatalf("expected two buffered commands flushed, got %v", received)
	}
	if received[0] != `{"type":"send","message":"first prompt"}` || received[1] != `{"type":"permissionDecision","permissionId":"perm_1","allowed":true}` {
		t.Fatalf("expected opaque commands flushed unchanged, got %v", received)
	}
}

func TestHostHandleDeliversOpaqueCommandAfterSenderRegistered(t *testing.T) {
	router := NewHostHandle("session_1")

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})
	router.deliverControl(rawControl(`{"type":"abort","reason":"user cancelled"}`))

	if received != `{"type":"abort","reason":"user cancelled"}` {
		t.Fatalf("expected opaque command delivered unchanged, got %q", received)
	}
}

func TestHostHandleDeliverCommandDropsEmptyCommand(t *testing.T) {
	router := NewHostHandle("session_1")

	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, string(command))
		return nil
	})
	router.DeliverCommand(nil)

	if len(received) != 0 {
		t.Fatalf("expected empty command to be dropped, got %v", received)
	}
}

func TestHostHandleDeliverCommandForwardsOpaqueCommand(t *testing.T) {
	router := NewHostHandle("session_1")

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})
	router.DeliverCommand(rawControl(`{"type":"send","message":"build it","extra":{"keep":true}}`))

	if received != `{"type":"send","message":"build it","extra":{"keep":true}}` {
		t.Fatalf("expected opaque command forwarded unchanged, got %q", received)
	}
}

func TestHostHandleLogsWhenLiveSendErrors(t *testing.T) {
	router := NewHostHandle("session_1")
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		return errors.New("send failed")
	})
	router.deliverControl(rawControl(`{"type":"send","message":"failing prompt"}`))
}

func TestHostHandleRegisterControlSenderLogsFlushErrorAndContinues(t *testing.T) {
	router := NewHostHandle("session_1")
	router.deliverControl(rawControl(`{"type":"send","message":"first"}`))
	router.deliverControl(rawControl(`{"type":"abort","reason":"second"}`))

	var calls int
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		calls += 1
		return errors.New("flush failed")
	})

	if calls != 2 {
		t.Fatalf("expected every buffered command to flush despite errors, got %d", calls)
	}
}
