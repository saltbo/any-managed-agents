from enum import Enum

class AmaEventType4Type(str, Enum):
    SESSION_STOP = "session_stop"

    def __str__(self) -> str:
        return str(self.value)
