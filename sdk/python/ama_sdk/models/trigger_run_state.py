from enum import Enum

class TriggerRunState(str, Enum):
    CLAIMED = "claimed"
    FAILED = "failed"
    SESSION_CREATED = "session_created"

    def __str__(self) -> str:
        return str(self.value)
