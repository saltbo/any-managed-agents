from enum import Enum

class AmaEventType17Type(str, Enum):
    RUNTIME_METADATA = "runtime.metadata"

    def __str__(self) -> str:
        return str(self.value)
