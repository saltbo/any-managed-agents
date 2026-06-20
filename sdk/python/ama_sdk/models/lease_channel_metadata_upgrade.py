from enum import Enum

class LeaseChannelMetadataUpgrade(str, Enum):
    WEBSOCKET = "websocket"

    def __str__(self) -> str:
        return str(self.value)
