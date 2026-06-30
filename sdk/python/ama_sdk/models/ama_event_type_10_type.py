from enum import Enum

class AmaEventType10Type(str, Enum):
    TOOL_EXECUTION_START = "tool_execution_start"

    def __str__(self) -> str:
        return str(self.value)
