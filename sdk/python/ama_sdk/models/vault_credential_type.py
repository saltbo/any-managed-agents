from enum import Enum

class VaultCredentialType(str, Enum):
    AMA_DEVOAUTH_TOKEN = "ama.dev/oauth-token"
    AMA_DEVPRIVATE_KEY_JWK = "ama.dev/private-key-jwk"
    KUBERNETES_IOBASIC_AUTH = "kubernetes.io/basic-auth"
    KUBERNETES_IOSSH_AUTH = "kubernetes.io/ssh-auth"
    KUBERNETES_IOTLS = "kubernetes.io/tls"
    OPAQUE = "Opaque"

    def __str__(self) -> str:
        return str(self.value)
