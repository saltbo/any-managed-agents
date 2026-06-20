from enum import Enum

class PolicyMcpPolicyDefaultEffect(str, Enum):
    ALLOW = "allow"
    DENY = "deny"

    def __str__(self) -> str:
        return str(self.value)
