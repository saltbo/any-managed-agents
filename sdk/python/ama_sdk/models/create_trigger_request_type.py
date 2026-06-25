from enum import Enum

class CreateTriggerRequestType(str, Enum):
    HTTP = "http"
    SCHEDULED = "scheduled"

    def __str__(self) -> str:
        return str(self.value)
