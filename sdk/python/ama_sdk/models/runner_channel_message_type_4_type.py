from enum import Enum

class RunnerChannelMessageType4Type(str, Enum):
    SANDBOX_RESPONSE = "sandbox.response"

    def __str__(self) -> str:
        return str(self.value)
