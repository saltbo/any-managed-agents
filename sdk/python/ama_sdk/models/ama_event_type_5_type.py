from enum import Enum

class AmaEventType5Type(str, Enum):
    SESSION_CHECKPOINT = "session_checkpoint"

    def __str__(self) -> str:
        return str(self.value)
