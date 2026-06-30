from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.tool_call_content_block_type import ToolCallContentBlockType
from typing import cast

if TYPE_CHECKING:
  from ..models.event_tool_call import EventToolCall





T = TypeVar("T", bound="ToolCallContentBlock")



@_attrs_define
class ToolCallContentBlock:
    """ 
        Attributes:
            type_ (ToolCallContentBlockType):
            tool_call (EventToolCall):
     """

    type_: ToolCallContentBlockType
    tool_call: EventToolCall
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_tool_call import EventToolCall
        type_ = self.type_.value

        tool_call = self.tool_call.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "toolCall": tool_call,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tool_call import EventToolCall
        d = dict(src_dict)
        type_ = ToolCallContentBlockType(d.pop("type"))




        tool_call = EventToolCall.from_dict(d.pop("toolCall"))




        tool_call_content_block = cls(
            type_=type_,
            tool_call=tool_call,
        )


        tool_call_content_block.additional_properties = d
        return tool_call_content_block

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
