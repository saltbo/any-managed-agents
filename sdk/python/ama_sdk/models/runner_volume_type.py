from enum import Enum

class RunnerVolumeType(str, Enum):
    GITHUB_REPOSITORY = "github_repository"
    MEMORY_STORE = "memory_store"
    SECRET = "secret"

    def __str__(self) -> str:
        return str(self.value)
