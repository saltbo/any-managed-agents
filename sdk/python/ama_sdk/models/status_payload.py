from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.status_payload_data import StatusPayloadData





T = TypeVar("T", bound="StatusPayload")



@_attrs_define
class StatusPayload:
    """ 
        Attributes:
            data (StatusPayloadData):
     """

    data: StatusPayloadData





    def to_dict(self) -> dict[str, Any]:
        from ..models.status_payload_data import StatusPayloadData
        data = self.data.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "data": data,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.status_payload_data import StatusPayloadData
        d = dict(src_dict)
        data = StatusPayloadData.from_dict(d.pop("data"))




        status_payload = cls(
            data=data,
        )

        return status_payload

