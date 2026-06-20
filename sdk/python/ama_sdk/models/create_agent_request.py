from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.agent_handoff_policy import AgentHandoffPolicy
  from ..models.agent_memory_policy import AgentMemoryPolicy
  from ..models.agent_subagent import AgentSubagent
  from ..models.agent_tool_attachment_input import AgentToolAttachmentInput
  from ..models.create_agent_request_metadata import CreateAgentRequestMetadata





T = TypeVar("T", bound="CreateAgentRequest")



@_attrs_define
class CreateAgentRequest:
    """ 
        Attributes:
            name (str):  Example: Research assistant.
            description (None | str | Unset):  Example: Answers with citations..
            instructions (None | str | Unset):  Example: Answer with citations..
            provider_id (None | str | Unset):  Example: provider_abc123.
            model (None | str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
            skills (list[str] | Unset):  Example: ['ama@code-review'].
            subagents (list[AgentSubagent] | Unset):  Example: [{'username': 'reviewer', 'role': 'reviewer'}].
            role (None | str | Unset):  Example: maintainer.
            capability_tags (list[str] | Unset):  Example: ['issue-triage', 'code-review'].
            handoff_policy (AgentHandoffPolicy | Unset):
            memory_policy (AgentMemoryPolicy | Unset):
            tools (list[AgentToolAttachmentInput] | Unset):
            mcp_connectors (list[str] | Unset):  Example: ['github'].
            metadata (CreateAgentRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    name: str
    description: None | str | Unset = UNSET
    instructions: None | str | Unset = UNSET
    provider_id: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    skills: list[str] | Unset = UNSET
    subagents: list[AgentSubagent] | Unset = UNSET
    role: None | str | Unset = UNSET
    capability_tags: list[str] | Unset = UNSET
    handoff_policy: AgentHandoffPolicy | Unset = UNSET
    memory_policy: AgentMemoryPolicy | Unset = UNSET
    tools: list[AgentToolAttachmentInput] | Unset = UNSET
    mcp_connectors: list[str] | Unset = UNSET
    metadata: CreateAgentRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_handoff_policy import AgentHandoffPolicy
        from ..models.agent_memory_policy import AgentMemoryPolicy
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment_input import AgentToolAttachmentInput
        from ..models.create_agent_request_metadata import CreateAgentRequestMetadata
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        instructions: None | str | Unset
        if isinstance(self.instructions, Unset):
            instructions = UNSET
        else:
            instructions = self.instructions

        provider_id: None | str | Unset
        if isinstance(self.provider_id, Unset):
            provider_id = UNSET
        else:
            provider_id = self.provider_id

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        skills: list[str] | Unset = UNSET
        if not isinstance(self.skills, Unset):
            skills = self.skills



        subagents: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.subagents, Unset):
            subagents = []
            for subagents_item_data in self.subagents:
                subagents_item = subagents_item_data.to_dict()
                subagents.append(subagents_item)



        role: None | str | Unset
        if isinstance(self.role, Unset):
            role = UNSET
        else:
            role = self.role

        capability_tags: list[str] | Unset = UNSET
        if not isinstance(self.capability_tags, Unset):
            capability_tags = self.capability_tags



        handoff_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.handoff_policy, Unset):
            handoff_policy = self.handoff_policy.to_dict()

        memory_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.memory_policy, Unset):
            memory_policy = self.memory_policy.to_dict()

        tools: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = []
            for tools_item_data in self.tools:
                tools_item = tools_item_data.to_dict()
                tools.append(tools_item)



        mcp_connectors: list[str] | Unset = UNSET
        if not isinstance(self.mcp_connectors, Unset):
            mcp_connectors = self.mcp_connectors



        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
        })
        if description is not UNSET:
            field_dict["description"] = description
        if instructions is not UNSET:
            field_dict["instructions"] = instructions
        if provider_id is not UNSET:
            field_dict["providerId"] = provider_id
        if model is not UNSET:
            field_dict["model"] = model
        if skills is not UNSET:
            field_dict["skills"] = skills
        if subagents is not UNSET:
            field_dict["subagents"] = subagents
        if role is not UNSET:
            field_dict["role"] = role
        if capability_tags is not UNSET:
            field_dict["capabilityTags"] = capability_tags
        if handoff_policy is not UNSET:
            field_dict["handoffPolicy"] = handoff_policy
        if memory_policy is not UNSET:
            field_dict["memoryPolicy"] = memory_policy
        if tools is not UNSET:
            field_dict["tools"] = tools
        if mcp_connectors is not UNSET:
            field_dict["mcpConnectors"] = mcp_connectors
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_handoff_policy import AgentHandoffPolicy
        from ..models.agent_memory_policy import AgentMemoryPolicy
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment_input import AgentToolAttachmentInput
        from ..models.create_agent_request_metadata import CreateAgentRequestMetadata
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        def _parse_instructions(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        instructions = _parse_instructions(d.pop("instructions", UNSET))


        def _parse_provider_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        provider_id = _parse_provider_id(d.pop("providerId", UNSET))


        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))


        skills = cast(list[str], d.pop("skills", UNSET))


        _subagents = d.pop("subagents", UNSET)
        subagents: list[AgentSubagent] | Unset = UNSET
        if _subagents is not UNSET:
            subagents = []
            for subagents_item_data in _subagents:
                subagents_item = AgentSubagent.from_dict(subagents_item_data)



                subagents.append(subagents_item)


        def _parse_role(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        role = _parse_role(d.pop("role", UNSET))


        capability_tags = cast(list[str], d.pop("capabilityTags", UNSET))


        _handoff_policy = d.pop("handoffPolicy", UNSET)
        handoff_policy: AgentHandoffPolicy | Unset
        if isinstance(_handoff_policy,  Unset):
            handoff_policy = UNSET
        else:
            handoff_policy = AgentHandoffPolicy.from_dict(_handoff_policy)




        _memory_policy = d.pop("memoryPolicy", UNSET)
        memory_policy: AgentMemoryPolicy | Unset
        if isinstance(_memory_policy,  Unset):
            memory_policy = UNSET
        else:
            memory_policy = AgentMemoryPolicy.from_dict(_memory_policy)




        _tools = d.pop("tools", UNSET)
        tools: list[AgentToolAttachmentInput] | Unset = UNSET
        if _tools is not UNSET:
            tools = []
            for tools_item_data in _tools:
                tools_item = AgentToolAttachmentInput.from_dict(tools_item_data)



                tools.append(tools_item)


        mcp_connectors = cast(list[str], d.pop("mcpConnectors", UNSET))


        _metadata = d.pop("metadata", UNSET)
        metadata: CreateAgentRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateAgentRequestMetadata.from_dict(_metadata)




        create_agent_request = cls(
            name=name,
            description=description,
            instructions=instructions,
            provider_id=provider_id,
            model=model,
            skills=skills,
            subagents=subagents,
            role=role,
            capability_tags=capability_tags,
            handoff_policy=handoff_policy,
            memory_policy=memory_policy,
            tools=tools,
            mcp_connectors=mcp_connectors,
            metadata=metadata,
        )

        return create_agent_request

