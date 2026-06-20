from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.policy_mcp_policy_default_effect import PolicyMcpPolicyDefaultEffect
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.policy_mcp_policy_connector_approval_modes import PolicyMcpPolicyConnectorApprovalModes





T = TypeVar("T", bound="PolicyMcpPolicy")



@_attrs_define
class PolicyMcpPolicy:
    """ 
        Attributes:
            allowed_connectors (list[str] | Unset):
            blocked_connectors (list[str] | Unset):
            require_approval_connectors (list[str] | Unset):
            require_approval_tools (list[str] | Unset):
            connector_approval_modes (PolicyMcpPolicyConnectorApprovalModes | Unset):
            default_effect (PolicyMcpPolicyDefaultEffect | Unset):
     """

    allowed_connectors: list[str] | Unset = UNSET
    blocked_connectors: list[str] | Unset = UNSET
    require_approval_connectors: list[str] | Unset = UNSET
    require_approval_tools: list[str] | Unset = UNSET
    connector_approval_modes: PolicyMcpPolicyConnectorApprovalModes | Unset = UNSET
    default_effect: PolicyMcpPolicyDefaultEffect | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.policy_mcp_policy_connector_approval_modes import PolicyMcpPolicyConnectorApprovalModes
        allowed_connectors: list[str] | Unset = UNSET
        if not isinstance(self.allowed_connectors, Unset):
            allowed_connectors = self.allowed_connectors



        blocked_connectors: list[str] | Unset = UNSET
        if not isinstance(self.blocked_connectors, Unset):
            blocked_connectors = self.blocked_connectors



        require_approval_connectors: list[str] | Unset = UNSET
        if not isinstance(self.require_approval_connectors, Unset):
            require_approval_connectors = self.require_approval_connectors



        require_approval_tools: list[str] | Unset = UNSET
        if not isinstance(self.require_approval_tools, Unset):
            require_approval_tools = self.require_approval_tools



        connector_approval_modes: dict[str, Any] | Unset = UNSET
        if not isinstance(self.connector_approval_modes, Unset):
            connector_approval_modes = self.connector_approval_modes.to_dict()

        default_effect: str | Unset = UNSET
        if not isinstance(self.default_effect, Unset):
            default_effect = self.default_effect.value



        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if allowed_connectors is not UNSET:
            field_dict["allowedConnectors"] = allowed_connectors
        if blocked_connectors is not UNSET:
            field_dict["blockedConnectors"] = blocked_connectors
        if require_approval_connectors is not UNSET:
            field_dict["requireApprovalConnectors"] = require_approval_connectors
        if require_approval_tools is not UNSET:
            field_dict["requireApprovalTools"] = require_approval_tools
        if connector_approval_modes is not UNSET:
            field_dict["connectorApprovalModes"] = connector_approval_modes
        if default_effect is not UNSET:
            field_dict["defaultEffect"] = default_effect

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.policy_mcp_policy_connector_approval_modes import PolicyMcpPolicyConnectorApprovalModes
        d = dict(src_dict)
        allowed_connectors = cast(list[str], d.pop("allowedConnectors", UNSET))


        blocked_connectors = cast(list[str], d.pop("blockedConnectors", UNSET))


        require_approval_connectors = cast(list[str], d.pop("requireApprovalConnectors", UNSET))


        require_approval_tools = cast(list[str], d.pop("requireApprovalTools", UNSET))


        _connector_approval_modes = d.pop("connectorApprovalModes", UNSET)
        connector_approval_modes: PolicyMcpPolicyConnectorApprovalModes | Unset
        if isinstance(_connector_approval_modes,  Unset):
            connector_approval_modes = UNSET
        else:
            connector_approval_modes = PolicyMcpPolicyConnectorApprovalModes.from_dict(_connector_approval_modes)




        _default_effect = d.pop("defaultEffect", UNSET)
        default_effect: PolicyMcpPolicyDefaultEffect | Unset
        if isinstance(_default_effect,  Unset):
            default_effect = UNSET
        else:
            default_effect = PolicyMcpPolicyDefaultEffect(_default_effect)




        policy_mcp_policy = cls(
            allowed_connectors=allowed_connectors,
            blocked_connectors=blocked_connectors,
            require_approval_connectors=require_approval_connectors,
            require_approval_tools=require_approval_tools,
            connector_approval_modes=connector_approval_modes,
            default_effect=default_effect,
        )


        policy_mcp_policy.additional_properties = d
        return policy_mcp_policy

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
