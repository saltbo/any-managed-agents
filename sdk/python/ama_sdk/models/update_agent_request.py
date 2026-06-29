from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.agent_handoff import AgentHandoff
  from ..models.agent_subagent import AgentSubagent
  from ..models.agent_tool_attachment_input import AgentToolAttachmentInput





T = TypeVar("T", bound="UpdateAgentRequest")



@_attrs_define
class UpdateAgentRequest:
    """ 
        Attributes:
            name (str | Unset):  Example: Research assistant.
            description (None | str | Unset):  Example: Answers with citations..
            system_prompt (None | str | Unset):  Example: Answer with citations..
            provider (None | str | Unset):  Example: provider_abc123.
            model (None | str | Unset):  Example: @cf/moonshotai/kimi-k2.6.
            skills (list[str] | Unset):  Example: ['ama@code-review'].
            subagents (list[AgentSubagent] | Unset):  Example: [{'username': 'reviewer', 'role': 'reviewer'}].
            role (None | str | Unset):  Example: maintainer.
            handoff (AgentHandoff | Unset):
            tools (list[AgentToolAttachmentInput] | Unset):
            mcp_connectors (list[str] | Unset):  Example: ['github'].
            archived (bool | Unset): Lifecycle transition: true archives the agent, false unarchives it.
     """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    system_prompt: None | str | Unset = UNSET
    provider: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    skills: list[str] | Unset = UNSET
    subagents: list[AgentSubagent] | Unset = UNSET
    role: None | str | Unset = UNSET
    handoff: AgentHandoff | Unset = UNSET
    tools: list[AgentToolAttachmentInput] | Unset = UNSET
    mcp_connectors: list[str] | Unset = UNSET
    archived: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_handoff import AgentHandoff
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment_input import AgentToolAttachmentInput
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        system_prompt: None | str | Unset
        if isinstance(self.system_prompt, Unset):
            system_prompt = UNSET
        else:
            system_prompt = self.system_prompt

        provider: None | str | Unset
        if isinstance(self.provider, Unset):
            provider = UNSET
        else:
            provider = self.provider

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

        handoff: dict[str, Any] | Unset = UNSET
        if not isinstance(self.handoff, Unset):
            handoff = self.handoff.to_dict()

        tools: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = []
            for tools_item_data in self.tools:
                tools_item = tools_item_data.to_dict()
                tools.append(tools_item)



        mcp_connectors: list[str] | Unset = UNSET
        if not isinstance(self.mcp_connectors, Unset):
            mcp_connectors = self.mcp_connectors



        archived = self.archived


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if system_prompt is not UNSET:
            field_dict["systemPrompt"] = system_prompt
        if provider is not UNSET:
            field_dict["provider"] = provider
        if model is not UNSET:
            field_dict["model"] = model
        if skills is not UNSET:
            field_dict["skills"] = skills
        if subagents is not UNSET:
            field_dict["subagents"] = subagents
        if role is not UNSET:
            field_dict["role"] = role
        if handoff is not UNSET:
            field_dict["handoff"] = handoff
        if tools is not UNSET:
            field_dict["tools"] = tools
        if mcp_connectors is not UNSET:
            field_dict["mcpConnectors"] = mcp_connectors
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_handoff import AgentHandoff
        from ..models.agent_subagent import AgentSubagent
        from ..models.agent_tool_attachment_input import AgentToolAttachmentInput
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        def _parse_system_prompt(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        system_prompt = _parse_system_prompt(d.pop("systemPrompt", UNSET))


        def _parse_provider(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        provider = _parse_provider(d.pop("provider", UNSET))


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


        _handoff = d.pop("handoff", UNSET)
        handoff: AgentHandoff | Unset
        if isinstance(_handoff,  Unset):
            handoff = UNSET
        else:
            handoff = AgentHandoff.from_dict(_handoff)




        _tools = d.pop("tools", UNSET)
        tools: list[AgentToolAttachmentInput] | Unset = UNSET
        if _tools is not UNSET:
            tools = []
            for tools_item_data in _tools:
                tools_item = AgentToolAttachmentInput.from_dict(tools_item_data)



                tools.append(tools_item)


        mcp_connectors = cast(list[str], d.pop("mcpConnectors", UNSET))


        archived = d.pop("archived", UNSET)

        update_agent_request = cls(
            name=name,
            description=description,
            system_prompt=system_prompt,
            provider=provider,
            model=model,
            skills=skills,
            subagents=subagents,
            role=role,
            handoff=handoff,
            tools=tools,
            mcp_connectors=mcp_connectors,
            archived=archived,
        )

        return update_agent_request

