package runtime

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/runtimebridge"
)

type bridgeProtocol struct{}

func (bridgeProtocol) scanner(reader io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(reader)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	return scanner
}

func (bridgeProtocol) encodeLine(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func (bridgeProtocol) waitReady(scanner *bufio.Scanner) error {
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return err
		}
		return fmt.Errorf("runtime bridge exited before ready")
	}
	var envelope runtimebridge.BridgeOutput
	if err := json.Unmarshal([]byte(scanner.Text()), &envelope); err != nil {
		return fmt.Errorf("invalid runtime bridge ready message: %w", err)
	}
	if envelope.Type != runtimebridge.BridgeMessageTypeReady {
		return fmt.Errorf("runtime bridge did not send ready message")
	}
	return nil
}

func (bridgeProtocol) readResult(scanner *bufio.Scanner, requestID string, write EventWriter, onResumeToken func(string)) (JSON, error) {
	for scanner.Scan() {
		var envelope runtimebridge.BridgeOutput
		if err := json.Unmarshal([]byte(scanner.Text()), &envelope); err != nil {
			return nil, fmt.Errorf("invalid runtime bridge message: %w", err)
		}
		if envelope.RequestID != "" && envelope.RequestID != requestID {
			continue
		}
		switch envelope.Type {
		case runtimebridge.BridgeMessageTypeResumeToken:
			if onResumeToken != nil && envelope.ResumeToken != "" {
				onResumeToken(envelope.ResumeToken)
			}
		case runtimebridge.BridgeMessageTypeSessionEvent:
			if envelope.EventType == "" {
				return nil, fmt.Errorf("runtime bridge event missing type")
			}
			if envelope.Payload == nil {
				envelope.Payload = JSON{}
			}
			if err := write(string(envelope.EventType), envelope.Payload); err != nil {
				return nil, err
			}
		case runtimebridge.BridgeMessageTypeResult:
			return envelope.Result, nil
		case runtimebridge.BridgeMessageTypeError:
			if envelope.Error.Message == "" {
				return nil, fmt.Errorf("runtime bridge failed")
			}
			return nil, fmt.Errorf("%s", envelope.Error.Message)
		default:
			return nil, fmt.Errorf("unsupported runtime bridge message type %q", envelope.Type)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("runtime bridge exited before result for request %q", requestID)
}

func (bridgeProtocol) controlFrame(requestID string, command BridgeControlFrame) runtimebridge.BridgeControl {
	frame := runtimebridge.BridgeControl{
		Type:      command.Type,
		RequestID: requestID,
	}
	if command.Message != "" {
		frame.Message = command.Message
	}
	if command.PermissionID != "" {
		frame.PermissionID = command.PermissionID
	}
	if command.Type == "permissionDecision" || command.Allowed {
		frame.Allowed = command.Allowed
	}
	if command.Reason != "" {
		frame.Reason = command.Reason
	}
	return frame
}

func (bridgeProtocol) inventorySnapshot(value JSON) (*InventorySnapshot, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var raw runtimebridge.BridgeInventoryResult
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	snapshot := &InventorySnapshot{Runtimes: make([]InventoryRuntime, 0, len(raw.Runtimes))}
	for _, item := range raw.Runtimes {
		if item.Runtime == "" {
			return nil, fmt.Errorf("runtime bridge inventory entry missing runtime")
		}
		snapshot.Runtimes = append(snapshot.Runtimes, InventoryRuntime{
			Runtime:        string(item.Runtime),
			Binary:         item.Binary,
			Installed:      item.Installed,
			FallbackModels: append([]string(nil), item.FallbackModels...),
			Models:         append([]string(nil), item.Models...),
			Status:         item.Status,
			Version:        item.Version,
			Detail:         item.Detail,
			UsageWindows:   append([]UsageWindow(nil), item.UsageWindows...),
			LimitedDetail:  item.LimitedDetail,
		})
	}
	return snapshot, nil
}
