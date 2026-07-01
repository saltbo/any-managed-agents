from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_channel_message_type_5_type import RunnerChannelMessageType5Type






T = TypeVar("T", bound="RunnerChannelMessageType5")



@_attrs_define
class RunnerChannelMessageType5:
    """ 
        Attributes:
            type_ (RunnerChannelMessageType5Type):
            event_id (str):
            session_id (str):  Example: session_abc123.
     """

    type_: RunnerChannelMessageType5Type
    event_id: str
    session_id: str





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        event_id = self.event_id

        session_id = self.session_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "eventId": event_id,
            "sessionId": session_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = RunnerChannelMessageType5Type(d.pop("type"))




        event_id = d.pop("eventId")

        session_id = d.pop("sessionId")

        runner_channel_message_type_5 = cls(
            type_=type_,
            event_id=event_id,
            session_id=session_id,
        )

        return runner_channel_message_type_5

