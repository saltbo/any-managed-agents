from enum import Enum

class UpdateConnectionRequestState(str, Enum):
    CONNECTED = "connected"
    DISABLED = "disabled"
    DISCONNECTED = "disconnected"

    def __str__(self) -> str:
        return str(self.value)
