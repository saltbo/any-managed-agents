from enum import Enum

class UpdateTriggerRequestSourceType0Type(str, Enum):
    SCHEDULE = "schedule"

    def __str__(self) -> str:
        return str(self.value)
