from enum import Enum

class AuditRecordActorType(str, Enum):
    SYSTEM = "system"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
