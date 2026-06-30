from enum import Enum

class AmaEventType1Type(str, Enum):
    AGENT_COMPLETED = "agent.completed"

    def __str__(self) -> str:
        return str(self.value)
