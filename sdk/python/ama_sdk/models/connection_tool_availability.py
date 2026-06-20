from enum import Enum

class ConnectionToolAvailability(str, Enum):
    AVAILABLE = "available"
    DISABLED = "disabled"
    ERROR = "error"

    def __str__(self) -> str:
        return str(self.value)
