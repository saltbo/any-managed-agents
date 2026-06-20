from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.agent_tool_attachment_approval_mode import AgentToolAttachmentApprovalMode
from typing import cast

if TYPE_CHECKING:
  from ..models.agent_tool_attachment_input_schema import AgentToolAttachmentInputSchema
  from ..models.agent_tool_attachment_policy_metadata import AgentToolAttachmentPolicyMetadata





T = TypeVar("T", bound="AgentToolAttachment")



@_attrs_define
class AgentToolAttachment:
    """ 
        Attributes:
            name (str):  Example: repo.read.
            description (None | str):  Example: Read repository metadata and files..
            input_schema (AgentToolAttachmentInputSchema):  Example: {'type': 'object', 'properties': {'repo': {'type':
                'string'}}}.
            approval_mode (AgentToolAttachmentApprovalMode):  Example: project_policy.
            policy_metadata (AgentToolAttachmentPolicyMetadata):  Example: {'sensitivity': 'low'}.
     """

    name: str
    description: None | str
    input_schema: AgentToolAttachmentInputSchema
    approval_mode: AgentToolAttachmentApprovalMode
    policy_metadata: AgentToolAttachmentPolicyMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_tool_attachment_input_schema import AgentToolAttachmentInputSchema
        from ..models.agent_tool_attachment_policy_metadata import AgentToolAttachmentPolicyMetadata
        name = self.name

        description: None | str
        description = self.description

        input_schema = self.input_schema.to_dict()

        approval_mode = self.approval_mode.value

        policy_metadata = self.policy_metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
            "description": description,
            "inputSchema": input_schema,
            "approvalMode": approval_mode,
            "policyMetadata": policy_metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_tool_attachment_input_schema import AgentToolAttachmentInputSchema
        from ..models.agent_tool_attachment_policy_metadata import AgentToolAttachmentPolicyMetadata
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))


        input_schema = AgentToolAttachmentInputSchema.from_dict(d.pop("inputSchema"))




        approval_mode = AgentToolAttachmentApprovalMode(d.pop("approvalMode"))




        policy_metadata = AgentToolAttachmentPolicyMetadata.from_dict(d.pop("policyMetadata"))




        agent_tool_attachment = cls(
            name=name,
            description=description,
            input_schema=input_schema,
            approval_mode=approval_mode,
            policy_metadata=policy_metadata,
        )


        agent_tool_attachment.additional_properties = d
        return agent_tool_attachment

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
