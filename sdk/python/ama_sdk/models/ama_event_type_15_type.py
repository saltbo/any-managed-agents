from enum import Enum

class AmaEventType15Type(str, Enum):
    PERMISSION_RESOLVED = "permission.resolved"

    def __str__(self) -> str:
        return str(self.value)
