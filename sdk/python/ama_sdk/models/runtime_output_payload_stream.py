from enum import Enum

class RuntimeOutputPayloadStream(str, Enum):
    BRIDGE = "bridge"
    REASONING = "reasoning"
    RUNTIME = "runtime"
    STDERR = "stderr"
    STDOUT = "stdout"

    def __str__(self) -> str:
        return str(self.value)
