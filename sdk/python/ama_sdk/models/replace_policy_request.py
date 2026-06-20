from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.policy_mcp_policy import PolicyMcpPolicy
  from ..models.policy_scope import PolicyScope
  from ..models.replace_policy_request_metadata import ReplacePolicyRequestMetadata
  from ..models.sandbox_policy import SandboxPolicy
  from ..models.tool_policy import ToolPolicy





T = TypeVar("T", bound="ReplacePolicyRequest")



@_attrs_define
class ReplacePolicyRequest:
    """ 
        Attributes:
            scope (PolicyScope | Unset):
            tool_policy (ToolPolicy | Unset):
            mcp_policy (PolicyMcpPolicy | Unset):
            sandbox_policy (SandboxPolicy | Unset):
            metadata (ReplacePolicyRequestMetadata | Unset):
     """

    scope: PolicyScope | Unset = UNSET
    tool_policy: ToolPolicy | Unset = UNSET
    mcp_policy: PolicyMcpPolicy | Unset = UNSET
    sandbox_policy: SandboxPolicy | Unset = UNSET
    metadata: ReplacePolicyRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.policy_mcp_policy import PolicyMcpPolicy
        from ..models.policy_scope import PolicyScope
        from ..models.replace_policy_request_metadata import ReplacePolicyRequestMetadata
        from ..models.sandbox_policy import SandboxPolicy
        from ..models.tool_policy import ToolPolicy
        scope: dict[str, Any] | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.to_dict()

        tool_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_policy, Unset):
            tool_policy = self.tool_policy.to_dict()

        mcp_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.mcp_policy, Unset):
            mcp_policy = self.mcp_policy.to_dict()

        sandbox_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.sandbox_policy, Unset):
            sandbox_policy = self.sandbox_policy.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if scope is not UNSET:
            field_dict["scope"] = scope
        if tool_policy is not UNSET:
            field_dict["toolPolicy"] = tool_policy
        if mcp_policy is not UNSET:
            field_dict["mcpPolicy"] = mcp_policy
        if sandbox_policy is not UNSET:
            field_dict["sandboxPolicy"] = sandbox_policy
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.policy_mcp_policy import PolicyMcpPolicy
        from ..models.policy_scope import PolicyScope
        from ..models.replace_policy_request_metadata import ReplacePolicyRequestMetadata
        from ..models.sandbox_policy import SandboxPolicy
        from ..models.tool_policy import ToolPolicy
        d = dict(src_dict)
        _scope = d.pop("scope", UNSET)
        scope: PolicyScope | Unset
        if isinstance(_scope,  Unset):
            scope = UNSET
        else:
            scope = PolicyScope.from_dict(_scope)




        _tool_policy = d.pop("toolPolicy", UNSET)
        tool_policy: ToolPolicy | Unset
        if isinstance(_tool_policy,  Unset):
            tool_policy = UNSET
        else:
            tool_policy = ToolPolicy.from_dict(_tool_policy)




        _mcp_policy = d.pop("mcpPolicy", UNSET)
        mcp_policy: PolicyMcpPolicy | Unset
        if isinstance(_mcp_policy,  Unset):
            mcp_policy = UNSET
        else:
            mcp_policy = PolicyMcpPolicy.from_dict(_mcp_policy)




        _sandbox_policy = d.pop("sandboxPolicy", UNSET)
        sandbox_policy: SandboxPolicy | Unset
        if isinstance(_sandbox_policy,  Unset):
            sandbox_policy = UNSET
        else:
            sandbox_policy = SandboxPolicy.from_dict(_sandbox_policy)




        _metadata = d.pop("metadata", UNSET)
        metadata: ReplacePolicyRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = ReplacePolicyRequestMetadata.from_dict(_metadata)




        replace_policy_request = cls(
            scope=scope,
            tool_policy=tool_policy,
            mcp_policy=mcp_policy,
            sandbox_policy=sandbox_policy,
            metadata=metadata,
        )

        return replace_policy_request

