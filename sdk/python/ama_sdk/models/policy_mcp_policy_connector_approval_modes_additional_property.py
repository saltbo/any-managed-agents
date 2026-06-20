from enum import Enum

class PolicyMcpPolicyConnectorApprovalModesAdditionalProperty(str, Enum):
    NONE = "none"
    REQUIRE_APPROVAL = "require_approval"

    def __str__(self) -> str:
        return str(self.value)
