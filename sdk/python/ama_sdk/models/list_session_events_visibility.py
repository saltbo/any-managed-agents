from enum import Enum

class ListSessionEventsVisibility(str, Enum):
    AUDIT = "audit"
    DEBUG = "debug"
    RUNTIME = "runtime"
    TRANSCRIPT = "transcript"

    def __str__(self) -> str:
        return str(self.value)
