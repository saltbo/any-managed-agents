from enum import Enum

class CreateTriggerRequestSourceType1Type(str, Enum):
    HTTP = "http"

    def __str__(self) -> str:
        return str(self.value)
