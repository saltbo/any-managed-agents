from enum import Enum

class AmaEventType6Type(str, Enum):
    SESSION_RESUMED = "session.resumed"

    def __str__(self) -> str:
        return str(self.value)
