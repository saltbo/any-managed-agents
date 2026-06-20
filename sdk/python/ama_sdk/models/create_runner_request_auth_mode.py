from enum import Enum

class CreateRunnerRequestAuthMode(str, Enum):
    BEARER = "bearer"
    FEDERATED = "federated"
    MTLS = "mtls"
    OIDC = "oidc"

    def __str__(self) -> str:
        return str(self.value)
