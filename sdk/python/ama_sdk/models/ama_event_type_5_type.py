from enum import Enum

class AmaEventType5Type(str, Enum):
    SESSION_CHECKPOINTED = "session.checkpointed"

    def __str__(self) -> str:
        return str(self.value)
