from enum import Enum

class AmaEventType2Type(str, Enum):
    TURN_START = "turn_start"

    def __str__(self) -> str:
        return str(self.value)
