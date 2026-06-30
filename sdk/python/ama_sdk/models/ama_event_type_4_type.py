from enum import Enum

class AmaEventType4Type(str, Enum):
    SESSION_STOPPED = "session.stopped"

    def __str__(self) -> str:
        return str(self.value)
