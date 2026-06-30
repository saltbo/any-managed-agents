from enum import Enum

class AmaEventType14Type(str, Enum):
    POLICY_DECISION = "policy.decision"

    def __str__(self) -> str:
        return str(self.value)
