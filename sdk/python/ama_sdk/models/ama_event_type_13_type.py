from enum import Enum

class AmaEventType13Type(str, Enum):
    USAGE_RECORDED = "usage.recorded"

    def __str__(self) -> str:
        return str(self.value)
