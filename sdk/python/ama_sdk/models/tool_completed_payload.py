from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_error import EventError
  from ..models.event_tool_call import EventToolCall





T = TypeVar("T", bound="ToolCompletedPayload")



@_attrs_define
class ToolCompletedPayload:
    """ 
        Attributes:
            tool_call (EventToolCall):
            result (Any | Unset):
            error (EventError | Unset):
            is_error (bool | Unset):
            duration_ms (float | Unset):
     """

    tool_call: EventToolCall
    result: Any | Unset = UNSET
    error: EventError | Unset = UNSET
    is_error: bool | Unset = UNSET
    duration_ms: float | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_error import EventError
        from ..models.event_tool_call import EventToolCall
        tool_call = self.tool_call.to_dict()

        result = self.result

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        is_error = self.is_error

        duration_ms = self.duration_ms


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "toolCall": tool_call,
        })
        if result is not UNSET:
            field_dict["result"] = result
        if error is not UNSET:
            field_dict["error"] = error
        if is_error is not UNSET:
            field_dict["isError"] = is_error
        if duration_ms is not UNSET:
            field_dict["durationMs"] = duration_ms

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_error import EventError
        from ..models.event_tool_call import EventToolCall
        d = dict(src_dict)
        tool_call = EventToolCall.from_dict(d.pop("toolCall"))




        result = d.pop("result", UNSET)

        _error = d.pop("error", UNSET)
        error: EventError | Unset
        if isinstance(_error,  Unset):
            error = UNSET
        else:
            error = EventError.from_dict(_error)




        is_error = d.pop("isError", UNSET)

        duration_ms = d.pop("durationMs", UNSET)

        tool_completed_payload = cls(
            tool_call=tool_call,
            result=result,
            error=error,
            is_error=is_error,
            duration_ms=duration_ms,
        )

        return tool_completed_payload

