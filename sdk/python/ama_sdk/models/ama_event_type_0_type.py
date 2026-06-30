from enum import Enum

class AmaEventType0Type(str, Enum):
    AGENT_START = "agent_start"

    def __str__(self) -> str:
        return str(self.value)
