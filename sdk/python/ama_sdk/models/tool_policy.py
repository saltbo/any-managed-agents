from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.tool_policy_default_effect import ToolPolicyDefaultEffect
from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="ToolPolicy")



@_attrs_define
class ToolPolicy:
    """ 
        Attributes:
            allowed_tools (list[str] | Unset):
            blocked_tools (list[str] | Unset):
            require_approval_tools (list[str] | Unset):
            default_effect (ToolPolicyDefaultEffect | Unset):
     """

    allowed_tools: list[str] | Unset = UNSET
    blocked_tools: list[str] | Unset = UNSET
    require_approval_tools: list[str] | Unset = UNSET
    default_effect: ToolPolicyDefaultEffect | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        allowed_tools: list[str] | Unset = UNSET
        if not isinstance(self.allowed_tools, Unset):
            allowed_tools = self.allowed_tools



        blocked_tools: list[str] | Unset = UNSET
        if not isinstance(self.blocked_tools, Unset):
            blocked_tools = self.blocked_tools



        require_approval_tools: list[str] | Unset = UNSET
        if not isinstance(self.require_approval_tools, Unset):
            require_approval_tools = self.require_approval_tools



        default_effect: str | Unset = UNSET
        if not isinstance(self.default_effect, Unset):
            default_effect = self.default_effect.value



        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if allowed_tools is not UNSET:
            field_dict["allowedTools"] = allowed_tools
        if blocked_tools is not UNSET:
            field_dict["blockedTools"] = blocked_tools
        if require_approval_tools is not UNSET:
            field_dict["requireApprovalTools"] = require_approval_tools
        if default_effect is not UNSET:
            field_dict["defaultEffect"] = default_effect

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        allowed_tools = cast(list[str], d.pop("allowedTools", UNSET))


        blocked_tools = cast(list[str], d.pop("blockedTools", UNSET))


        require_approval_tools = cast(list[str], d.pop("requireApprovalTools", UNSET))


        _default_effect = d.pop("defaultEffect", UNSET)
        default_effect: ToolPolicyDefaultEffect | Unset
        if isinstance(_default_effect,  Unset):
            default_effect = UNSET
        else:
            default_effect = ToolPolicyDefaultEffect(_default_effect)




        tool_policy = cls(
            allowed_tools=allowed_tools,
            blocked_tools=blocked_tools,
            require_approval_tools=require_approval_tools,
            default_effect=default_effect,
        )


        tool_policy.additional_properties = d
        return tool_policy

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
