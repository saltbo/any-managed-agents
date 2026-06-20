from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.agent_memory_metadata import AgentMemoryMetadata





T = TypeVar("T", bound="AgentMemory")



@_attrs_define
class AgentMemory:
    """ 
        Attributes:
            agent_id (str):  Example: agent_abc123.
            project_id (str):  Example: project_abc123.
            content (str):  Example: Previous heartbeat checked open PRs and deferred billing export..
            metadata (AgentMemoryMetadata):  Example: {'format': 'markdown'}.
            created_at (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
            updated_at (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
     """

    agent_id: str
    project_id: str
    content: str
    metadata: AgentMemoryMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_memory_metadata import AgentMemoryMetadata
        agent_id = self.agent_id

        project_id = self.project_id

        content = self.content

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "agentId": agent_id,
            "projectId": project_id,
            "content": content,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_memory_metadata import AgentMemoryMetadata
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        project_id = d.pop("projectId")

        content = d.pop("content")

        metadata = AgentMemoryMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        agent_memory = cls(
            agent_id=agent_id,
            project_id=project_id,
            content=content,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        agent_memory.additional_properties = d
        return agent_memory

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
