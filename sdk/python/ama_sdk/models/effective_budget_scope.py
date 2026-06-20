from enum import Enum

class EffectiveBudgetScope(str, Enum):
    MODEL = "model"
    PROJECT = "project"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
