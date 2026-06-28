from enum import Enum

class SessionStatusPhase(str, Enum):
    ERROR = "error"
    IDLE = "idle"
    PENDING = "pending"
    RUNNING = "running"
    STOPPED = "stopped"

    def __str__(self) -> str:
        return str(self.value)
