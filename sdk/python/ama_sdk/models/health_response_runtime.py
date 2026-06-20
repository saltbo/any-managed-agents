from enum import Enum

class HealthResponseRuntime(str, Enum):
    CLOUDFLARE_WORKERS = "cloudflare-workers"

    def __str__(self) -> str:
        return str(self.value)
