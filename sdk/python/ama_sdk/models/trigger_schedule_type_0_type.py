from enum import Enum

class TriggerScheduleType0Type(str, Enum):
    INTERVAL = "interval"

    def __str__(self) -> str:
        return str(self.value)
