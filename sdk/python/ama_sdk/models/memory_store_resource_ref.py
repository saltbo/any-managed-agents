from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.memory_store_resource_ref_access import MemoryStoreResourceRefAccess
from ..models.memory_store_resource_ref_type import MemoryStoreResourceRefType






T = TypeVar("T", bound="MemoryStoreResourceRef")



@_attrs_define
class MemoryStoreResourceRef:
    """ 
        Attributes:
            type_ (MemoryStoreResourceRefType):
            store_id (str):  Example: memstore_abc123.
            access (MemoryStoreResourceRefAccess):  Example: read_only.
     """

    type_: MemoryStoreResourceRefType
    store_id: str
    access: MemoryStoreResourceRefAccess





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        store_id = self.store_id

        access = self.access.value


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "storeId": store_id,
            "access": access,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = MemoryStoreResourceRefType(d.pop("type"))




        store_id = d.pop("storeId")

        access = MemoryStoreResourceRefAccess(d.pop("access"))




        memory_store_resource_ref = cls(
            type_=type_,
            store_id=store_id,
            access=access,
        )

        return memory_store_resource_ref

