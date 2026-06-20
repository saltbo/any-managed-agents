from enum import Enum

class ListConnectionsState(str, Enum):
    CONNECTED = "connected"
    DISABLED = "disabled"
    DISCONNECTED = "disconnected"
    ERROR = "error"

    def __str__(self) -> str:
        return str(self.value)
