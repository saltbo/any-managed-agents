from enum import Enum

class AmaEventType19Type(str, Enum):
    RUNNER_METADATA = "runner.metadata"

    def __str__(self) -> str:
        return str(self.value)
