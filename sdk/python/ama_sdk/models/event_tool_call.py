from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="EventToolCall")



@_attrs_define
class EventToolCall:
    """ 
        Attributes:
            id (str):
            name (str):
            input_ (Any | Unset):
     """

    id: str
    name: str
    input_: Any | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        input_ = self.input_


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "id": id,
            "name": name,
        })
        if input_ is not UNSET:
            field_dict["input"] = input_

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        input_ = d.pop("input", UNSET)

        event_tool_call = cls(
            id=id,
            name=name,
            input_=input_,
        )

        return event_tool_call

