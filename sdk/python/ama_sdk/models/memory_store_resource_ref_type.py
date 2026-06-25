from enum import Enum

class MemoryStoreResourceRefType(str, Enum):
    MEMORY_STORE = "memory_store"

    def __str__(self) -> str:
        return str(self.value)
