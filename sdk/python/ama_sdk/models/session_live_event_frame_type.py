from enum import Enum

class SessionLiveEventFrameType(str, Enum):
    EVENT = "event"

    def __str__(self) -> str:
        return str(self.value)
