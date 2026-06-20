from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_tool_call_request_input import CreateToolCallRequestInput





T = TypeVar("T", bound="CreateToolCallRequest")



@_attrs_define
class CreateToolCallRequest:
    """ 
        Attributes:
            session_id (str):
            input_ (CreateToolCallRequestInput | Unset):
     """

    session_id: str
    input_: CreateToolCallRequestInput | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_tool_call_request_input import CreateToolCallRequestInput
        session_id = self.session_id

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "sessionId": session_id,
        })
        if input_ is not UNSET:
            field_dict["input"] = input_

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_tool_call_request_input import CreateToolCallRequestInput
        d = dict(src_dict)
        session_id = d.pop("sessionId")

        _input_ = d.pop("input", UNSET)
        input_: CreateToolCallRequestInput | Unset
        if isinstance(_input_,  Unset):
            input_ = UNSET
        else:
            input_ = CreateToolCallRequestInput.from_dict(_input_)




        create_tool_call_request = cls(
            session_id=session_id,
            input_=input_,
        )

        return create_tool_call_request

