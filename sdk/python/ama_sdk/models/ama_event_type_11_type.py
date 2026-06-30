from enum import Enum

class AmaEventType11Type(str, Enum):
    TOOL_CALL_UPDATED = "tool_call.updated"

    def __str__(self) -> str:
        return str(self.value)
