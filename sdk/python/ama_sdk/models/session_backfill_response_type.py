from enum import Enum

class SessionBackfillResponseType(str, Enum):
    BACKFILL = "backfill"

    def __str__(self) -> str:
        return str(self.value)
