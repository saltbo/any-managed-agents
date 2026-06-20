from enum import Enum

class SessionSteerFrameType(str, Enum):
    STEER = "steer"

    def __str__(self) -> str:
        return str(self.value)
