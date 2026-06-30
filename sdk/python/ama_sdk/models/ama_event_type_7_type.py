from enum import Enum

class AmaEventType7Type(str, Enum):
    MESSAGE_STARTED = "message.started"

    def __str__(self) -> str:
        return str(self.value)
