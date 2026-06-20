from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.agent_tool_attachment_input_approval_mode import AgentToolAttachmentInputApprovalMode
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.agent_tool_attachment_input_input_schema import AgentToolAttachmentInputInputSchema
  from ..models.agent_tool_attachment_input_policy_metadata import AgentToolAttachmentInputPolicyMetadata





T = TypeVar("T", bound="AgentToolAttachmentInput")



@_attrs_define
class AgentToolAttachmentInput:
    """ 
        Attributes:
            name (str):  Example: repo.read.
            description (None | str | Unset):  Example: Read repository metadata and files..
            input_schema (AgentToolAttachmentInputInputSchema | Unset):  Example: {'type': 'object', 'properties': {'repo':
                {'type': 'string'}}}.
            approval_mode (AgentToolAttachmentInputApprovalMode | Unset):  Example: project_policy.
            policy_metadata (AgentToolAttachmentInputPolicyMetadata | Unset):  Example: {'sensitivity': 'low'}.
     """

    name: str
    description: None | str | Unset = UNSET
    input_schema: AgentToolAttachmentInputInputSchema | Unset = UNSET
    approval_mode: AgentToolAttachmentInputApprovalMode | Unset = UNSET
    policy_metadata: AgentToolAttachmentInputPolicyMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_tool_attachment_input_input_schema import AgentToolAttachmentInputInputSchema
        from ..models.agent_tool_attachment_input_policy_metadata import AgentToolAttachmentInputPolicyMetadata
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        input_schema: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_schema, Unset):
            input_schema = self.input_schema.to_dict()

        approval_mode: str | Unset = UNSET
        if not isinstance(self.approval_mode, Unset):
            approval_mode = self.approval_mode.value


        policy_metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.policy_metadata, Unset):
            policy_metadata = self.policy_metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
        })
        if description is not UNSET:
            field_dict["description"] = description
        if input_schema is not UNSET:
            field_dict["inputSchema"] = input_schema
        if approval_mode is not UNSET:
            field_dict["approvalMode"] = approval_mode
        if policy_metadata is not UNSET:
            field_dict["policyMetadata"] = policy_metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_tool_attachment_input_input_schema import AgentToolAttachmentInputInputSchema
        from ..models.agent_tool_attachment_input_policy_metadata import AgentToolAttachmentInputPolicyMetadata
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        _input_schema = d.pop("inputSchema", UNSET)
        input_schema: AgentToolAttachmentInputInputSchema | Unset
        if isinstance(_input_schema,  Unset):
            input_schema = UNSET
        else:
            input_schema = AgentToolAttachmentInputInputSchema.from_dict(_input_schema)




        _approval_mode = d.pop("approvalMode", UNSET)
        approval_mode: AgentToolAttachmentInputApprovalMode | Unset
        if isinstance(_approval_mode,  Unset):
            approval_mode = UNSET
        else:
            approval_mode = AgentToolAttachmentInputApprovalMode(_approval_mode)




        _policy_metadata = d.pop("policyMetadata", UNSET)
        policy_metadata: AgentToolAttachmentInputPolicyMetadata | Unset
        if isinstance(_policy_metadata,  Unset):
            policy_metadata = UNSET
        else:
            policy_metadata = AgentToolAttachmentInputPolicyMetadata.from_dict(_policy_metadata)




        agent_tool_attachment_input = cls(
            name=name,
            description=description,
            input_schema=input_schema,
            approval_mode=approval_mode,
            policy_metadata=policy_metadata,
        )

        return agent_tool_attachment_input

