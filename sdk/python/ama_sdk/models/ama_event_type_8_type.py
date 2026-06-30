from enum import Enum

class AmaEventType8Type(str, Enum):
    MESSAGE_UPDATE = "message_update"

    def __str__(self) -> str:
        return str(self.value)
