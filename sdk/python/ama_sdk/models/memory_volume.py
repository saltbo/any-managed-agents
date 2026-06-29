from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.memory_volume_access import MemoryVolumeAccess
from ..models.memory_volume_type import MemoryVolumeType
from ..types import UNSET, Unset






T = TypeVar("T", bound="MemoryVolume")



@_attrs_define
class MemoryVolume:
    """ 
        Attributes:
            name (str):  Example: team-memory.
            type_ (MemoryVolumeType):
            memory_ref (str):  Example: ama://memories/memstore_abc123.
            access (MemoryVolumeAccess):  Example: read_only.
            store_name (str | Unset):
            description (str | Unset):
     """

    name: str
    type_: MemoryVolumeType
    memory_ref: str
    access: MemoryVolumeAccess
    store_name: str | Unset = UNSET
    description: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        memory_ref = self.memory_ref

        access = self.access.value

        store_name = self.store_name

        description = self.description


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
            "memoryRef": memory_ref,
            "access": access,
        })
        if store_name is not UNSET:
            field_dict["storeName"] = store_name
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = MemoryVolumeType(d.pop("type"))




        memory_ref = d.pop("memoryRef")

        access = MemoryVolumeAccess(d.pop("access"))




        store_name = d.pop("storeName", UNSET)

        description = d.pop("description", UNSET)

        memory_volume = cls(
            name=name,
            type_=type_,
            memory_ref=memory_ref,
            access=access,
            store_name=store_name,
            description=description,
        )

        return memory_volume

