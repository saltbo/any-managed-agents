from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_mcp_policy_default_effect import EnvironmentMcpPolicyDefaultEffect
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.environment_mcp_policy_connector_approval_modes import EnvironmentMcpPolicyConnectorApprovalModes





T = TypeVar("T", bound="EnvironmentMcpPolicy")



@_attrs_define
class EnvironmentMcpPolicy:
    """ 
        Example:
            {'allowedConnectors': ['github']}

        Attributes:
            allowed_connectors (list[str] | Unset):
            blocked_connectors (list[str] | Unset):
            require_approval_connectors (list[str] | Unset):
            require_approval_tools (list[str] | Unset):
            connector_approval_modes (EnvironmentMcpPolicyConnectorApprovalModes | Unset):
            default_effect (EnvironmentMcpPolicyDefaultEffect | Unset):
     """

    allowed_connectors: list[str] | Unset = UNSET
    blocked_connectors: list[str] | Unset = UNSET
    require_approval_connectors: list[str] | Unset = UNSET
    require_approval_tools: list[str] | Unset = UNSET
    connector_approval_modes: EnvironmentMcpPolicyConnectorApprovalModes | Unset = UNSET
    default_effect: EnvironmentMcpPolicyDefaultEffect | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_mcp_policy_connector_approval_modes import EnvironmentMcpPolicyConnectorApprovalModes
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
        from ..models.environment_mcp_policy_connector_approval_modes import EnvironmentMcpPolicyConnectorApprovalModes
        d = dict(src_dict)
        allowed_connectors = cast(list[str], d.pop("allowedConnectors", UNSET))


        blocked_connectors = cast(list[str], d.pop("blockedConnectors", UNSET))


        require_approval_connectors = cast(list[str], d.pop("requireApprovalConnectors", UNSET))


        require_approval_tools = cast(list[str], d.pop("requireApprovalTools", UNSET))


        _connector_approval_modes = d.pop("connectorApprovalModes", UNSET)
        connector_approval_modes: EnvironmentMcpPolicyConnectorApprovalModes | Unset
        if isinstance(_connector_approval_modes,  Unset):
            connector_approval_modes = UNSET
        else:
            connector_approval_modes = EnvironmentMcpPolicyConnectorApprovalModes.from_dict(_connector_approval_modes)




        _default_effect = d.pop("defaultEffect", UNSET)
        default_effect: EnvironmentMcpPolicyDefaultEffect | Unset
        if isinstance(_default_effect,  Unset):
            default_effect = UNSET
        else:
            default_effect = EnvironmentMcpPolicyDefaultEffect(_default_effect)




        environment_mcp_policy = cls(
            allowed_connectors=allowed_connectors,
            blocked_connectors=blocked_connectors,
            require_approval_connectors=require_approval_connectors,
            require_approval_tools=require_approval_tools,
            connector_approval_modes=connector_approval_modes,
            default_effect=default_effect,
        )

        return environment_mcp_policy

