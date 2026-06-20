from enum import Enum

class EnvironmentMcpPolicyConnectorApprovalModesAdditionalProperty(str, Enum):
    NONE = "none"
    REQUIRE_APPROVAL = "require_approval"

    def __str__(self) -> str:
        return str(self.value)
