from enum import Enum

class RunnerChannelMessageType7Type(str, Enum):
    RUNNER_EVENT = "runner.event"

    def __str__(self) -> str:
        return str(self.value)
