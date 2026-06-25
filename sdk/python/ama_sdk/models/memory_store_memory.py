from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.memory_store_memory_metadata import MemoryStoreMemoryMetadata





T = TypeVar("T", bound="MemoryStoreMemory")



@_attrs_define
class MemoryStoreMemory:
    """ 
        Attributes:
            id (str):  Example: memory_abc123.
            store_id (str):  Example: memstore_abc123.
            project_id (str):  Example: project_abc123.
            path (str):  Example: guides/review.md.
            content (str):  Example: Review for correctness first..
            metadata (MemoryStoreMemoryMetadata):
            created_at (datetime.datetime):  Example: 2026-06-25T00:00:00.000Z.
            updated_at (datetime.datetime):  Example: 2026-06-25T00:00:00.000Z.
     """

    id: str
    store_id: str
    project_id: str
    path: str
    content: str
    metadata: MemoryStoreMemoryMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.memory_store_memory_metadata import MemoryStoreMemoryMetadata
        id = self.id

        store_id = self.store_id

        project_id = self.project_id

        path = self.path

        content = self.content

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "storeId": store_id,
            "projectId": project_id,
            "path": path,
            "content": content,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.memory_store_memory_metadata import MemoryStoreMemoryMetadata
        d = dict(src_dict)
        id = d.pop("id")

        store_id = d.pop("storeId")

        project_id = d.pop("projectId")

        path = d.pop("path")

        content = d.pop("content")

        metadata = MemoryStoreMemoryMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        memory_store_memory = cls(
            id=id,
            store_id=store_id,
            project_id=project_id,
            path=path,
            content=content,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        memory_store_memory.additional_properties = d
        return memory_store_memory

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
