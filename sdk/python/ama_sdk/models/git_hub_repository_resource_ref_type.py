from enum import Enum

class GitHubRepositoryResourceRefType(str, Enum):
    GITHUB_REPOSITORY = "github_repository"

    def __str__(self) -> str:
        return str(self.value)
