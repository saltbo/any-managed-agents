from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.event_tool_call import EventToolCall





T = TypeVar("T", bound="ToolStartedPayload")



@_attrs_define
class ToolStartedPayload:
    """ 
        Attributes:
            tool_call (EventToolCall):
     """

    tool_call: EventToolCall





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_tool_call import EventToolCall
        tool_call = self.tool_call.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "toolCall": tool_call,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tool_call import EventToolCall
        d = dict(src_dict)
        tool_call = EventToolCall.from_dict(d.pop("toolCall"))




        tool_started_payload = cls(
            tool_call=tool_call,
        )

        return tool_started_payload

