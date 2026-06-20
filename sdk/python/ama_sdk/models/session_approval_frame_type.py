from enum import Enum

class SessionApprovalFrameType(str, Enum):
    APPROVAL = "approval"

    def __str__(self) -> str:
        return str(self.value)
