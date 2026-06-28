from enum import Enum

class VaultCredentialVersionType0Provider(str, Enum):
    AMA = "ama"

    def __str__(self) -> str:
        return str(self.value)
