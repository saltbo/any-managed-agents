from enum import Enum

class ListTriggerRunsState(str, Enum):
    CLAIMED = "claimed"
    DISPATCHED = "dispatched"
    FAILED = "failed"

    def __str__(self) -> str:
        return str(self.value)
