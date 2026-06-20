from enum import Enum

class SessionEventVisibility(str, Enum):
    AUDIT = "audit"
    DEBUG = "debug"
    RUNTIME = "runtime"
    TRANSCRIPT = "transcript"

    def __str__(self) -> str:
        return str(self.value)
