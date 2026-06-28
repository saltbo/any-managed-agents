package daemon

import (
	"fmt"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func EnsureCompatibleHealth(health *ama.HealthResponse) error {
	if health == nil {
		return fmt.Errorf("AMA health response is empty")
	}
	if health.Status != ama.Ok || health.Name != "Any Managed Agents" {
		return fmt.Errorf("incompatible AMA control plane: %s/%s", health.Name, health.Status)
	}
	return nil
}
