from enum import Enum

class SessionPromptFrameType(str, Enum):
    PROMPT = "prompt"

    def __str__(self) -> str:
        return str(self.value)
