from enum import Enum

class AmaEventType1Type(str, Enum):
    AGENT_END = "agent_end"

    def __str__(self) -> str:
        return str(self.value)
