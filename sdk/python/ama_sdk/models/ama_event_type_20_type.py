from enum import Enum

class AmaEventType20Type(str, Enum):
    RUNNER_STATUS = "runner.status"

    def __str__(self) -> str:
        return str(self.value)
