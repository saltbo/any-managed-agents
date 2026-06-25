from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.memory_store_metadata import MemoryStoreMetadata





T = TypeVar("T", bound="MemoryStore")



@_attrs_define
class MemoryStore:
    """ 
        Attributes:
            id (str):  Example: memstore_abc123.
            project_id (str):  Example: project_abc123.
            name (str):  Example: Team conventions.
            description (None | str):  Example: Shared repository and review preferences..
            metadata (MemoryStoreMetadata):  Example: {'owner': 'platform'}.
            archived_at (datetime.datetime | None):
            created_at (datetime.datetime):  Example: 2026-06-25T00:00:00.000Z.
            updated_at (datetime.datetime):  Example: 2026-06-25T00:00:00.000Z.
     """

    id: str
    project_id: str
    name: str
    description: None | str
    metadata: MemoryStoreMetadata
    archived_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.memory_store_metadata import MemoryStoreMetadata
        id = self.id

        project_id = self.project_id

        name = self.name

        description: None | str
        description = self.description

        metadata = self.metadata.to_dict()

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "name": name,
            "description": description,
            "metadata": metadata,
            "archivedAt": archived_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.memory_store_metadata import MemoryStoreMetadata
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))


        metadata = MemoryStoreMetadata.from_dict(d.pop("metadata"))




        def _parse_archived_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                archived_at_type_0 = datetime.datetime.fromisoformat(data)



                return archived_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        memory_store = cls(
            id=id,
            project_id=project_id,
            name=name,
            description=description,
            metadata=metadata,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        memory_store.additional_properties = d
        return memory_store

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
