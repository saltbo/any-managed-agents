from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.session_event_input_metadata import SessionEventInputMetadata
  from ..models.session_event_input_payload import SessionEventInputPayload





T = TypeVar("T", bound="SessionEventInput")



@_attrs_define
class SessionEventInput:
    """ 
        Attributes:
            type_ (str):
            payload (SessionEventInputPayload):
            metadata (SessionEventInputMetadata | Unset):
     """

    type_: str
    payload: SessionEventInputPayload
    metadata: SessionEventInputMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_event_input_metadata import SessionEventInputMetadata
        from ..models.session_event_input_payload import SessionEventInputPayload
        type_ = self.type_

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
        from ..models.session_event_input_metadata import SessionEventInputMetadata
        from ..models.session_event_input_payload import SessionEventInputPayload
        d = dict(src_dict)
        type_ = d.pop("type")

        payload = SessionEventInputPayload.from_dict(d.pop("payload"))




        _metadata = d.pop("metadata", UNSET)
        metadata: SessionEventInputMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = SessionEventInputMetadata.from_dict(_metadata)




        session_event_input = cls(
            type_=type_,
            payload=payload,
            metadata=metadata,
        )

        return session_event_input

