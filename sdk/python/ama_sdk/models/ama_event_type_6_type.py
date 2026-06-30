from enum import Enum

class AmaEventType6Type(str, Enum):
    SESSION_RESUME = "session_resume"

    def __str__(self) -> str:
        return str(self.value)
