from enum import Enum

class AmaEventType10Type(str, Enum):
    TOOL_CALL_STARTED = "tool_call.started"

    def __str__(self) -> str:
        return str(self.value)
