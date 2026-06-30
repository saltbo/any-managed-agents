from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_18_type import AmaEventType18Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_metadata import EventMetadata
  from ..models.runtime_output_payload import RuntimeOutputPayload





T = TypeVar("T", bound="AmaEventType18")



@_attrs_define
class AmaEventType18:
    """ 
        Attributes:
            type_ (AmaEventType18Type):
            payload (RuntimeOutputPayload):
            metadata (EventMetadata | Unset):
     """

    type_: AmaEventType18Type
    payload: RuntimeOutputPayload
    metadata: EventMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_metadata import EventMetadata
        from ..models.runtime_output_payload import RuntimeOutputPayload
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
        from ..models.runtime_output_payload import RuntimeOutputPayload
        d = dict(src_dict)
        type_ = AmaEventType18Type(d.pop("type"))




        payload = RuntimeOutputPayload.from_dict(d.pop("payload"))




        _metadata = d.pop("metadata", UNSET)
        metadata: EventMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = EventMetadata.from_dict(_metadata)




        ama_event_type_18 = cls(
            type_=type_,
            payload=payload,
            metadata=metadata,
        )

        return ama_event_type_18

