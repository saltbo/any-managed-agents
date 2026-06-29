from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.agent_handoff import AgentHandoff
  from ..models.agent_subagent import AgentSubagent
  from ..models.agent_tool_attachment import AgentToolAttachment





T = TypeVar("T", bound="AgentSpec")



@_attrs_define
class AgentSpec:
    """ 
        Attributes:
            system_prompt (None | str):  Example: Answer with citations..
            provider (None | str):  Example: provider_abc123.
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
            skills (list[str]):  Example: ['ama@code-review'].
            subagents (list[AgentSubagent]):  Example: [{'username': 'reviewer', 'role': 'reviewer'}].
            role (None | str):  Example: maintainer.
            handoff (AgentHandoff):
            tools (list[AgentToolAttachment]):
            mcp_connectors (list[str]):  Example: ['github'].
     """

    system_prompt: None | str
    provider: None | str
    model: None | str
    skills: list[str]
    subagents: list[AgentSubagent]
    role: None | str
    handoff: AgentHandoff
    tools: list[AgentToolAttachment]
    mcp_connectors: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_handoff import AgentHandoff
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment import AgentToolAttachment
        system_prompt: None | str
        system_prompt = self.system_prompt

        provider: None | str
        provider = self.provider

        model: None | str
        model = self.model

        skills = self.skills



        subagents = []
        for subagents_item_data in self.subagents:
            subagents_item = subagents_item_data.to_dict()
            subagents.append(subagents_item)



        role: None | str
        role = self.role

        handoff = self.handoff.to_dict()

        tools = []
        for tools_item_data in self.tools:
            tools_item = tools_item_data.to_dict()
            tools.append(tools_item)



        mcp_connectors = self.mcp_connectors




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "systemPrompt": system_prompt,
            "provider": provider,
            "model": model,
            "skills": skills,
            "subagents": subagents,
            "role": role,
            "handoff": handoff,
            "tools": tools,
            "mcpConnectors": mcp_connectors,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_handoff import AgentHandoff
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment import AgentToolAttachment
        d = dict(src_dict)
        def _parse_system_prompt(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        system_prompt = _parse_system_prompt(d.pop("systemPrompt"))


        def _parse_provider(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider = _parse_provider(d.pop("provider"))


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


        handoff = AgentHandoff.from_dict(d.pop("handoff"))




        tools = []
        _tools = d.pop("tools")
        for tools_item_data in (_tools):
            tools_item = AgentToolAttachment.from_dict(tools_item_data)



            tools.append(tools_item)


        mcp_connectors = cast(list[str], d.pop("mcpConnectors"))


        agent_spec = cls(
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            skills=skills,
            subagents=subagents,
            role=role,
            handoff=handoff,
            tools=tools,
            mcp_connectors=mcp_connectors,
        )


        agent_spec.additional_properties = d
        return agent_spec

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
