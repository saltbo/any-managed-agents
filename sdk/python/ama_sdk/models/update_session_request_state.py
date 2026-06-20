from enum import Enum

class UpdateSessionRequestState(str, Enum):
    STOPPED = "stopped"

    def __str__(self) -> str:
        return str(self.value)
