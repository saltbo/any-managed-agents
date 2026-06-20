from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.session_agent_snapshot_handoff_policy import SessionAgentSnapshotHandoffPolicy
  from ..models.session_agent_snapshot_memory_policy import SessionAgentSnapshotMemoryPolicy
  from ..models.session_agent_snapshot_metadata import SessionAgentSnapshotMetadata
  from ..models.session_agent_snapshot_subagents_item import SessionAgentSnapshotSubagentsItem
  from ..models.session_agent_snapshot_tools_item import SessionAgentSnapshotToolsItem





T = TypeVar("T", bound="SessionAgentSnapshot")



@_attrs_define
class SessionAgentSnapshot:
    """ 
        Attributes:
            id (str):
            agent_id (str):
            project_id (str):
            version (int):
            instructions (None | str):
            provider_id (str):  Example: workers-ai.
            model (None | str):
            skills (list[str]):
            subagents (list[SessionAgentSnapshotSubagentsItem]):
            role (None | str):
            capability_tags (list[str]):
            handoff_policy (SessionAgentSnapshotHandoffPolicy):
            memory_policy (SessionAgentSnapshotMemoryPolicy):
            tools (list[SessionAgentSnapshotToolsItem]):
            mcp_connectors (list[str]):
            metadata (SessionAgentSnapshotMetadata):
            created_at (datetime.datetime):
     """

    id: str
    agent_id: str
    project_id: str
    version: int
    instructions: None | str
    provider_id: str
    model: None | str
    skills: list[str]
    subagents: list[SessionAgentSnapshotSubagentsItem]
    role: None | str
    capability_tags: list[str]
    handoff_policy: SessionAgentSnapshotHandoffPolicy
    memory_policy: SessionAgentSnapshotMemoryPolicy
    tools: list[SessionAgentSnapshotToolsItem]
    mcp_connectors: list[str]
    metadata: SessionAgentSnapshotMetadata
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_agent_snapshot_handoff_policy import SessionAgentSnapshotHandoffPolicy
        from ..models.session_agent_snapshot_memory_policy import SessionAgentSnapshotMemoryPolicy
        from ..models.session_agent_snapshot_metadata import SessionAgentSnapshotMetadata
        from ..models.session_agent_snapshot_subagents_item import SessionAgentSnapshotSubagentsItem
        from ..models.session_agent_snapshot_tools_item import SessionAgentSnapshotToolsItem
        id = self.id

        agent_id = self.agent_id

        project_id = self.project_id

        version = self.version

        instructions: None | str
        instructions = self.instructions

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
        from ..models.session_agent_snapshot_handoff_policy import SessionAgentSnapshotHandoffPolicy
        from ..models.session_agent_snapshot_memory_policy import SessionAgentSnapshotMemoryPolicy
        from ..models.session_agent_snapshot_metadata import SessionAgentSnapshotMetadata
        from ..models.session_agent_snapshot_subagents_item import SessionAgentSnapshotSubagentsItem
        from ..models.session_agent_snapshot_tools_item import SessionAgentSnapshotToolsItem
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


        provider_id = d.pop("providerId")

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        skills = cast(list[str], d.pop("skills"))


        subagents = []
        _subagents = d.pop("subagents")
        for subagents_item_data in (_subagents):
            subagents_item = SessionAgentSnapshotSubagentsItem.from_dict(subagents_item_data)



            subagents.append(subagents_item)


        def _parse_role(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        role = _parse_role(d.pop("role"))


        capability_tags = cast(list[str], d.pop("capabilityTags"))


        handoff_policy = SessionAgentSnapshotHandoffPolicy.from_dict(d.pop("handoffPolicy"))




        memory_policy = SessionAgentSnapshotMemoryPolicy.from_dict(d.pop("memoryPolicy"))




        tools = []
        _tools = d.pop("tools")
        for tools_item_data in (_tools):
            tools_item = SessionAgentSnapshotToolsItem.from_dict(tools_item_data)



            tools.append(tools_item)


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        metadata = SessionAgentSnapshotMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        session_agent_snapshot = cls(
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


        session_agent_snapshot.additional_properties = d
        return session_agent_snapshot

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
