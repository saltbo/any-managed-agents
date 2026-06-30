from enum import Enum

class AmaEventType15Type(str, Enum):
    PERMISSION_REQUEST = "permission.request"

    def __str__(self) -> str:
        return str(self.value)
