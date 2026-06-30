from enum import Enum

class AmaEventType18Type(str, Enum):
    RUNTIME_STATUS = "runtime.status"

    def __str__(self) -> str:
        return str(self.value)
