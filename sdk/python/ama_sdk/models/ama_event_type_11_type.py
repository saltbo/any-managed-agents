from enum import Enum

class AmaEventType11Type(str, Enum):
    TOOL_EXECUTION_UPDATE = "tool_execution_update"

    def __str__(self) -> str:
        return str(self.value)
