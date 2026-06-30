from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_message import EventMessage





T = TypeVar("T", bound="TurnPayload")



@_attrs_define
class TurnPayload:
    """ 
        Attributes:
            marker (str | Unset):
            stage (str | Unset):
            status (str | Unset):
            message (EventMessage | Unset):
            tool_results (list[Any] | Unset):
     """

    marker: str | Unset = UNSET
    stage: str | Unset = UNSET
    status: str | Unset = UNSET
    message: EventMessage | Unset = UNSET
    tool_results: list[Any] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_message import EventMessage
        marker = self.marker

        stage = self.stage

        status = self.status

        message: dict[str, Any] | Unset = UNSET
        if not isinstance(self.message, Unset):
            message = self.message.to_dict()

        tool_results: list[Any] | Unset = UNSET
        if not isinstance(self.tool_results, Unset):
            tool_results = self.tool_results




        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if marker is not UNSET:
            field_dict["marker"] = marker
        if stage is not UNSET:
            field_dict["stage"] = stage
        if status is not UNSET:
            field_dict["status"] = status
        if message is not UNSET:
            field_dict["message"] = message
        if tool_results is not UNSET:
            field_dict["toolResults"] = tool_results

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_message import EventMessage
        d = dict(src_dict)
        marker = d.pop("marker", UNSET)

        stage = d.pop("stage", UNSET)

        status = d.pop("status", UNSET)

        _message = d.pop("message", UNSET)
        message: EventMessage | Unset
        if isinstance(_message,  Unset):
            message = UNSET
        else:
            message = EventMessage.from_dict(_message)




        tool_results = cast(list[Any], d.pop("toolResults", UNSET))


        turn_payload = cls(
            marker=marker,
            stage=stage,
            status=status,
            message=message,
            tool_results=tool_results,
        )

        return turn_payload

