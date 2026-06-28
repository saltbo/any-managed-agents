from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.memory_store_volume_access import MemoryStoreVolumeAccess
from ..models.memory_store_volume_type import MemoryStoreVolumeType
from ..types import UNSET, Unset






T = TypeVar("T", bound="MemoryStoreVolume")



@_attrs_define
class MemoryStoreVolume:
    """ 
        Attributes:
            name (str):  Example: team-memory.
            type_ (MemoryStoreVolumeType):
            store_id (str):  Example: memstore_abc123.
            access (MemoryStoreVolumeAccess):  Example: read_only.
            store_name (str | Unset):
            description (str | Unset):
     """

    name: str
    type_: MemoryStoreVolumeType
    store_id: str
    access: MemoryStoreVolumeAccess
    store_name: str | Unset = UNSET
    description: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_.value

        store_id = self.store_id

        access = self.access.value

        store_name = self.store_name

        description = self.description


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
            "storeId": store_id,
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

        type_ = MemoryStoreVolumeType(d.pop("type"))




        store_id = d.pop("storeId")

        access = MemoryStoreVolumeAccess(d.pop("access"))




        store_name = d.pop("storeName", UNSET)

        description = d.pop("description", UNSET)

        memory_store_volume = cls(
            name=name,
            type_=type_,
            store_id=store_id,
            access=access,
            store_name=store_name,
            description=description,
        )

        return memory_store_volume

