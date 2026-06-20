from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="AgentHandoffCandidate")



@_attrs_define
class AgentHandoffCandidate:
    """ 
        Attributes:
            id (str):  Example: agent_def456.
            name (str):  Example: Implementation worker.
            role (None | str):  Example: worker.
            capability_tags (list[str]):  Example: ['implementation'].
     """

    id: str
    name: str
    role: None | str
    capability_tags: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        role: None | str
        role = self.role

        capability_tags = self.capability_tags




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "name": name,
            "role": role,
            "capabilityTags": capability_tags,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_role(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        role = _parse_role(d.pop("role"))


        capability_tags = cast(list[str], d.pop("capabilityTags"))


        agent_handoff_candidate = cls(
            id=id,
            name=name,
            role=role,
            capability_tags=capability_tags,
        )


        agent_handoff_candidate.additional_properties = d
        return agent_handoff_candidate

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
