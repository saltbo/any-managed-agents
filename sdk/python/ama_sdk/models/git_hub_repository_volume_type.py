from enum import Enum

class GitHubRepositoryVolumeType(str, Enum):
    GITHUB_REPOSITORY = "github_repository"

    def __str__(self) -> str:
        return str(self.value)
