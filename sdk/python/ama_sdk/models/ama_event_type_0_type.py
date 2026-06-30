from enum import Enum

class AmaEventType0Type(str, Enum):
    AGENT_STARTED = "agent.started"

    def __str__(self) -> str:
        return str(self.value)
