from enum import Enum

class UpdateTriggerRequestScheduleType(str, Enum):
    INTERVAL = "interval"

    def __str__(self) -> str:
        return str(self.value)
