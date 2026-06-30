from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_socket_event_message_type import SessionSocketEventMessageType
from typing import cast

if TYPE_CHECKING:
  from ..models.event_record import EventRecord





T = TypeVar("T", bound="SessionSocketEventMessage")



@_attrs_define
class SessionSocketEventMessage:
    """ 
        Attributes:
            type_ (SessionSocketEventMessageType):
            record (EventRecord):
     """

    type_: SessionSocketEventMessageType
    record: EventRecord
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_record import EventRecord
        type_ = self.type_.value

        record = self.record.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "record": record,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_record import EventRecord
        d = dict(src_dict)
        type_ = SessionSocketEventMessageType(d.pop("type"))




        record = EventRecord.from_dict(d.pop("record"))




        session_socket_event_message = cls(
            type_=type_,
            record=record,
        )


        session_socket_event_message.additional_properties = d
        return session_socket_event_message

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
