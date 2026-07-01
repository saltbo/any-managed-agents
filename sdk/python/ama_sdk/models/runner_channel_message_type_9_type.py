from enum import Enum

class RunnerChannelMessageType9Type(str, Enum):
    SESSION_CHANNEL_ERROR = "session.channel.error"

    def __str__(self) -> str:
        return str(self.value)
