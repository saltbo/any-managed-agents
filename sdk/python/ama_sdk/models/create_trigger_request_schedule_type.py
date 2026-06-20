from enum import Enum

class CreateTriggerRequestScheduleType(str, Enum):
    INTERVAL = "interval"

    def __str__(self) -> str:
        return str(self.value)
