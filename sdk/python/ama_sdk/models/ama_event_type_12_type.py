from enum import Enum

class AmaEventType12Type(str, Enum):
    TOOL_CALL_COMPLETED = "tool_call.completed"

    def __str__(self) -> str:
        return str(self.value)
