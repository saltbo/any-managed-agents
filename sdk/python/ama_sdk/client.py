from dataclasses import dataclass


@dataclass(frozen=True)
class AmaClient:
    origin: str
    access_token: str
