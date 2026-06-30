from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.metadata_payload_data import MetadataPayloadData





T = TypeVar("T", bound="MetadataPayload")



@_attrs_define
class MetadataPayload:
    """ 
        Attributes:
            data (MetadataPayloadData):
     """

    data: MetadataPayloadData





    def to_dict(self) -> dict[str, Any]:
        from ..models.metadata_payload_data import MetadataPayloadData
        data = self.data.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "data": data,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.metadata_payload_data import MetadataPayloadData
        d = dict(src_dict)
        data = MetadataPayloadData.from_dict(d.pop("data"))




        metadata_payload = cls(
            data=data,
        )

        return metadata_payload

