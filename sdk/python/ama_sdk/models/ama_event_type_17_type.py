from enum import Enum

class AmaEventType17Type(str, Enum):
    RUNTIME_ERROR = "runtime.error"

    def __str__(self) -> str:
        return str(self.value)
