from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_memory_store_request_metadata import CreateMemoryStoreRequestMetadata





T = TypeVar("T", bound="CreateMemoryStoreRequest")



@_attrs_define
class CreateMemoryStoreRequest:
    """ 
        Attributes:
            name (str):  Example: Team conventions.
            description (str | Unset):  Example: Shared repository and review preferences..
            metadata (CreateMemoryStoreRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    name: str
    description: str | Unset = UNSET
    metadata: CreateMemoryStoreRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_memory_store_request_metadata import CreateMemoryStoreRequestMetadata
        name = self.name

        description = self.description

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
        })
        if description is not UNSET:
            field_dict["description"] = description
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_memory_store_request_metadata import CreateMemoryStoreRequestMetadata
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateMemoryStoreRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateMemoryStoreRequestMetadata.from_dict(_metadata)




        create_memory_store_request = cls(
            name=name,
            description=description,
            metadata=metadata,
        )


        create_memory_store_request.additional_properties = d
        return create_memory_store_request

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
