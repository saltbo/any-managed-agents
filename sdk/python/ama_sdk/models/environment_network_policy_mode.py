from enum import Enum

class EnvironmentNetworkPolicyMode(str, Enum):
    OFFLINE = "offline"
    RESTRICTED = "restricted"
    UNRESTRICTED = "unrestricted"

    def __str__(self) -> str:
        return str(self.value)
