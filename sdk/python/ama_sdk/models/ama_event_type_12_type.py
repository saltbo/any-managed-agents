from enum import Enum

class AmaEventType12Type(str, Enum):
    TOOL_EXECUTION_END = "tool_execution_end"

    def __str__(self) -> str:
        return str(self.value)
