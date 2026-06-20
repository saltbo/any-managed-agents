from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.policy_mcp_policy import PolicyMcpPolicy
  from ..models.policy_metadata import PolicyMetadata
  from ..models.policy_scope import PolicyScope
  from ..models.sandbox_policy import SandboxPolicy
  from ..models.tool_policy import ToolPolicy





T = TypeVar("T", bound="Policy")



@_attrs_define
class Policy:
    """ 
        Attributes:
            id (str):
            project_id (str):
            scope (PolicyScope):
            tool_policy (ToolPolicy):
            mcp_policy (PolicyMcpPolicy):
            sandbox_policy (SandboxPolicy):
            metadata (PolicyMetadata):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    scope: PolicyScope
    tool_policy: ToolPolicy
    mcp_policy: PolicyMcpPolicy
    sandbox_policy: SandboxPolicy
    metadata: PolicyMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.policy_mcp_policy import PolicyMcpPolicy
        from ..models.policy_metadata import PolicyMetadata
        from ..models.policy_scope import PolicyScope
        from ..models.sandbox_policy import SandboxPolicy
        from ..models.tool_policy import ToolPolicy
        id = self.id

        project_id = self.project_id

        scope = self.scope.to_dict()

        tool_policy = self.tool_policy.to_dict()

        mcp_policy = self.mcp_policy.to_dict()

        sandbox_policy = self.sandbox_policy.to_dict()

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "scope": scope,
            "toolPolicy": tool_policy,
            "mcpPolicy": mcp_policy,
            "sandboxPolicy": sandbox_policy,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.policy_mcp_policy import PolicyMcpPolicy
        from ..models.policy_metadata import PolicyMetadata
        from ..models.policy_scope import PolicyScope
        from ..models.sandbox_policy import SandboxPolicy
        from ..models.tool_policy import ToolPolicy
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        scope = PolicyScope.from_dict(d.pop("scope"))




        tool_policy = ToolPolicy.from_dict(d.pop("toolPolicy"))




        mcp_policy = PolicyMcpPolicy.from_dict(d.pop("mcpPolicy"))




        sandbox_policy = SandboxPolicy.from_dict(d.pop("sandboxPolicy"))




        metadata = PolicyMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        policy = cls(
            id=id,
            project_id=project_id,
            scope=scope,
            tool_policy=tool_policy,
            mcp_policy=mcp_policy,
            sandbox_policy=sandbox_policy,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        policy.additional_properties = d
        return policy

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
