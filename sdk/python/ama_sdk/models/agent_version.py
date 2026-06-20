from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.agent_handoff_policy import AgentHandoffPolicy
  from ..models.agent_memory_policy import AgentMemoryPolicy
  from ..models.agent_subagent import AgentSubagent
  from ..models.agent_tool_attachment import AgentToolAttachment
  from ..models.agent_version_metadata import AgentVersionMetadata





T = TypeVar("T", bound="AgentVersion")



@_attrs_define
class AgentVersion:
    """ 
        Attributes:
            id (str):  Example: agentver_abc123.
            agent_id (str):  Example: agent_abc123.
            project_id (str):  Example: project_abc123.
            version (int):  Example: 1.
            instructions (None | str):  Example: Answer with citations..
            provider_id (None | str):  Example: provider_abc123.
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
            skills (list[str]):  Example: ['ama@code-review'].
            subagents (list[AgentSubagent]):  Example: [{'username': 'reviewer', 'role': 'reviewer'}].
            role (None | str):  Example: maintainer.
            capability_tags (list[str]):  Example: ['issue-triage', 'code-review'].
            handoff_policy (AgentHandoffPolicy):
            memory_policy (AgentMemoryPolicy):
            tools (list[AgentToolAttachment]):
            mcp_connectors (list[str]):  Example: ['github'].
            metadata (AgentVersionMetadata):  Example: {'owner': 'platform'}.
            created_at (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
     """

    id: str
    agent_id: str
    project_id: str
    version: int
    instructions: None | str
    provider_id: None | str
    model: None | str
    skills: list[str]
    subagents: list[AgentSubagent]
    role: None | str
    capability_tags: list[str]
    handoff_policy: AgentHandoffPolicy
    memory_policy: AgentMemoryPolicy
    tools: list[AgentToolAttachment]
    mcp_connectors: list[str]
    metadata: AgentVersionMetadata
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_handoff_policy import AgentHandoffPolicy
        from ..models.agent_memory_policy import AgentMemoryPolicy
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment import AgentToolAttachment
        from ..models.agent_version_metadata import AgentVersionMetadata
        id = self.id

        agent_id = self.agent_id

        project_id = self.project_id

        version = self.version

        instructions: None | str
        instructions = self.instructions

        provider_id: None | str
        provider_id = self.provider_id

        model: None | str
        model = self.model

        skills = self.skills



        subagents = []
        for subagents_item_data in self.subagents:
            subagents_item = subagents_item_data.to_dict()
            subagents.append(subagents_item)



        role: None | str
        role = self.role

        capability_tags = self.capability_tags



        handoff_policy = self.handoff_policy.to_dict()

        memory_policy = self.memory_policy.to_dict()

        tools = []
        for tools_item_data in self.tools:
            tools_item = tools_item_data.to_dict()
            tools.append(tools_item)



        mcp_connectors = self.mcp_connectors



        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "agentId": agent_id,
            "projectId": project_id,
            "version": version,
            "instructions": instructions,
            "providerId": provider_id,
            "model": model,
            "skills": skills,
            "subagents": subagents,
            "role": role,
            "capabilityTags": capability_tags,
            "handoffPolicy": handoff_policy,
            "memoryPolicy": memory_policy,
            "tools": tools,
            "mcpConnectors": mcp_connectors,
            "metadata": metadata,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_handoff_policy import AgentHandoffPolicy
        from ..models.agent_memory_policy import AgentMemoryPolicy
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment import AgentToolAttachment
        from ..models.agent_version_metadata import AgentVersionMetadata
        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        project_id = d.pop("projectId")

        version = d.pop("version")

        def _parse_instructions(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        instructions = _parse_instructions(d.pop("instructions"))


        def _parse_provider_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_id = _parse_provider_id(d.pop("providerId"))


        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        skills = cast(list[str], d.pop("skills"))


        subagents = []
        _subagents = d.pop("subagents")
        for subagents_item_data in (_subagents):
            subagents_item = AgentSubagent.from_dict(subagents_item_data)



            subagents.append(subagents_item)


        def _parse_role(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        role = _parse_role(d.pop("role"))


        capability_tags = cast(list[str], d.pop("capabilityTags"))


        handoff_policy = AgentHandoffPolicy.from_dict(d.pop("handoffPolicy"))




        memory_policy = AgentMemoryPolicy.from_dict(d.pop("memoryPolicy"))




        tools = []
        _tools = d.pop("tools")
        for tools_item_data in (_tools):
            tools_item = AgentToolAttachment.from_dict(tools_item_data)



            tools.append(tools_item)


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        metadata = AgentVersionMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        agent_version = cls(
            id=id,
            agent_id=agent_id,
            project_id=project_id,
            version=version,
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
            created_at=created_at,
        )


        agent_version.additional_properties = d
        return agent_version

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
