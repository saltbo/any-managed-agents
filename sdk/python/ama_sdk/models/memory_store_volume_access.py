from enum import Enum

class MemoryStoreVolumeAccess(str, Enum):
    READ_ONLY = "read_only"
    READ_WRITE = "read_write"

    def __str__(self) -> str:
        return str(self.value)
