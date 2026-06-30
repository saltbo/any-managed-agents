from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.ama_event_type_14_type import AmaEventType14Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_metadata import EventMetadata
  from ..models.policy_decision_payload import PolicyDecisionPayload





T = TypeVar("T", bound="AmaEventType14")



@_attrs_define
class AmaEventType14:
    """ 
        Attributes:
            type_ (AmaEventType14Type):
            payload (PolicyDecisionPayload):
            metadata (EventMetadata | Unset):
     """

    type_: AmaEventType14Type
    payload: PolicyDecisionPayload
    metadata: EventMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_metadata import EventMetadata
        from ..models.policy_decision_payload import PolicyDecisionPayload
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
        from ..models.policy_decision_payload import PolicyDecisionPayload
        d = dict(src_dict)
        type_ = AmaEventType14Type(d.pop("type"))




        payload = PolicyDecisionPayload.from_dict(d.pop("payload"))




        _metadata = d.pop("metadata", UNSET)
        metadata: EventMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = EventMetadata.from_dict(_metadata)




        ama_event_type_14 = cls(
            type_=type_,
            payload=payload,
            metadata=metadata,
        )

        return ama_event_type_14

