from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_resource_ref import RunnerResourceRef
  from ..models.runner_sandbox_request_input import RunnerSandboxRequestInput





T = TypeVar("T", bound="RunnerSandboxRequest")



@_attrs_define
class RunnerSandboxRequest:
    """ 
        Attributes:
            type_ (str):  Example: sandbox.execute.
            tool_call_id (str | Unset):  Example: call_abc123.
            tool_name (str | Unset):  Example: sandbox.exec.
            input_ (RunnerSandboxRequestInput | Unset):
            resource_refs (list[RunnerResourceRef] | Unset):
     """

    type_: str
    tool_call_id: str | Unset = UNSET
    tool_name: str | Unset = UNSET
    input_: RunnerSandboxRequestInput | Unset = UNSET
    resource_refs: list[RunnerResourceRef] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_resource_ref import RunnerResourceRef
        from ..models.runner_sandbox_request_input import RunnerSandboxRequestInput
        type_ = self.type_

        tool_call_id = self.tool_call_id

        tool_name = self.tool_name

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        resource_refs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.resource_refs, Unset):
            resource_refs = []
            for resource_refs_item_data in self.resource_refs:
                resource_refs_item = resource_refs_item_data.to_dict()
                resource_refs.append(resource_refs_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
        })
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id
        if tool_name is not UNSET:
            field_dict["toolName"] = tool_name
        if input_ is not UNSET:
            field_dict["input"] = input_
        if resource_refs is not UNSET:
            field_dict["resourceRefs"] = resource_refs

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_resource_ref import RunnerResourceRef
        from ..models.runner_sandbox_request_input import RunnerSandboxRequestInput
        d = dict(src_dict)
        type_ = d.pop("type")

        tool_call_id = d.pop("toolCallId", UNSET)

        tool_name = d.pop("toolName", UNSET)

        _input_ = d.pop("input", UNSET)
        input_: RunnerSandboxRequestInput | Unset
        if isinstance(_input_,  Unset):
            input_ = UNSET
        else:
            input_ = RunnerSandboxRequestInput.from_dict(_input_)




        _resource_refs = d.pop("resourceRefs", UNSET)
        resource_refs: list[RunnerResourceRef] | Unset = UNSET
        if _resource_refs is not UNSET:
            resource_refs = []
            for resource_refs_item_data in _resource_refs:
                resource_refs_item = RunnerResourceRef.from_dict(resource_refs_item_data)



                resource_refs.append(resource_refs_item)


        runner_sandbox_request = cls(
            type_=type_,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            input_=input_,
            resource_refs=resource_refs,
        )

        return runner_sandbox_request

