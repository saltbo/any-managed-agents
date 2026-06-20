from enum import Enum

class VaultCredentialVersionType0Provider(str, Enum):
    AMA_MANAGED = "ama-managed"
    CLOUDFLARE_SECRETS = "cloudflare-secrets"
    EXTERNAL_VAULT = "external-vault"

    def __str__(self) -> str:
        return str(self.value)
