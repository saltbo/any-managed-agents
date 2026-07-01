from enum import Enum

class RunnerChannelMessageType5Type(str, Enum):
    SESSION_BACKFILL_REQUEST = "session.backfill_request"

    def __str__(self) -> str:
        return str(self.value)
