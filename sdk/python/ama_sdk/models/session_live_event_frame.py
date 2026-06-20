from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_live_event_frame_type import SessionLiveEventFrameType
from typing import cast

if TYPE_CHECKING:
  from ..models.session_event import SessionEvent





T = TypeVar("T", bound="SessionLiveEventFrame")



@_attrs_define
class SessionLiveEventFrame:
    """ 
        Attributes:
            type_ (SessionLiveEventFrameType):
            event (SessionEvent):
     """

    type_: SessionLiveEventFrameType
    event: SessionEvent
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_event import SessionEvent
        type_ = self.type_.value

        event = self.event.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "event": event,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_event import SessionEvent
        d = dict(src_dict)
        type_ = SessionLiveEventFrameType(d.pop("type"))




        event = SessionEvent.from_dict(d.pop("event"))




        session_live_event_frame = cls(
            type_=type_,
            event=event,
        )


        session_live_event_frame.additional_properties = d
        return session_live_event_frame

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
