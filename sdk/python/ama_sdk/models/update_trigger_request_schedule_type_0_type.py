from enum import Enum

class UpdateTriggerRequestScheduleType0Type(str, Enum):
    INTERVAL = "interval"

    def __str__(self) -> str:
        return str(self.value)
