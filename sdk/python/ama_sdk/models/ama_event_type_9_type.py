from enum import Enum

class AmaEventType9Type(str, Enum):
    MESSAGE_END = "message_end"

    def __str__(self) -> str:
        return str(self.value)
