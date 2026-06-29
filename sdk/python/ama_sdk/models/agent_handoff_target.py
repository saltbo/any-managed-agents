from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="AgentHandoffTarget")



@_attrs_define
class AgentHandoffTarget:
    """ 
        Attributes:
            role (str | Unset):
            capability (str | Unset):
     """

    role: str | Unset = UNSET
    capability: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        role = self.role

        capability = self.capability


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if role is not UNSET:
            field_dict["role"] = role
        if capability is not UNSET:
            field_dict["capability"] = capability

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = d.pop("role", UNSET)

        capability = d.pop("capability", UNSET)

        agent_handoff_target = cls(
            role=role,
            capability=capability,
        )

        return agent_handoff_target

