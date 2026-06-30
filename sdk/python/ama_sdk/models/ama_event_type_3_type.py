from enum import Enum

class AmaEventType3Type(str, Enum):
    TURN_END = "turn_end"

    def __str__(self) -> str:
        return str(self.value)
