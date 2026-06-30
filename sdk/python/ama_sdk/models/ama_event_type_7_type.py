from enum import Enum

class AmaEventType7Type(str, Enum):
    MESSAGE_START = "message_start"

    def __str__(self) -> str:
        return str(self.value)
