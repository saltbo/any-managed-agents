from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_tool_call import EventToolCall





T = TypeVar("T", bound="ToolUpdatedPayload")



@_attrs_define
class ToolUpdatedPayload:
    """ 
        Attributes:
            tool_call (EventToolCall):
            partial_result (Any | Unset):
     """

    tool_call: EventToolCall
    partial_result: Any | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_tool_call import EventToolCall
        tool_call = self.tool_call.to_dict()

        partial_result = self.partial_result


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "toolCall": tool_call,
        })
        if partial_result is not UNSET:
            field_dict["partialResult"] = partial_result

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tool_call import EventToolCall
        d = dict(src_dict)
        tool_call = EventToolCall.from_dict(d.pop("toolCall"))




        partial_result = d.pop("partialResult", UNSET)

        tool_updated_payload = cls(
            tool_call=tool_call,
            partial_result=partial_result,
        )

        return tool_updated_payload

