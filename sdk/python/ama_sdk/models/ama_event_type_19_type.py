from enum import Enum

class AmaEventType19Type(str, Enum):
    RUNTIME_OUTPUT = "runtime.output"

    def __str__(self) -> str:
        return str(self.value)
