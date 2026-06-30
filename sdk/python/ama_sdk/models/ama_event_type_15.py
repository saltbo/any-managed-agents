from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_15_type import AmaEventType15Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_metadata import EventMetadata
  from ..models.permission_resolved_payload import PermissionResolvedPayload





T = TypeVar("T", bound="AmaEventType15")



@_attrs_define
class AmaEventType15:
    """ 
        Attributes:
            type_ (AmaEventType15Type):
            payload (PermissionResolvedPayload):
            metadata (EventMetadata | Unset):
     """

    type_: AmaEventType15Type
    payload: PermissionResolvedPayload
    metadata: EventMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_metadata import EventMetadata
        from ..models.permission_resolved_payload import PermissionResolvedPayload
        type_ = self.type_.value

        payload = self.payload.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "payload": payload,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_metadata import EventMetadata
        from ..models.permission_resolved_payload import PermissionResolvedPayload
        d = dict(src_dict)
        type_ = AmaEventType15Type(d.pop("type"))




        payload = PermissionResolvedPayload.from_dict(d.pop("payload"))




        _metadata = d.pop("metadata", UNSET)
        metadata: EventMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = EventMetadata.from_dict(_metadata)




        ama_event_type_15 = cls(
            type_=type_,
            payload=payload,
            metadata=metadata,
        )

        return ama_event_type_15

