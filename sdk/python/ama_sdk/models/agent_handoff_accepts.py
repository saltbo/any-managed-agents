from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="AgentHandoffAccepts")



@_attrs_define
class AgentHandoffAccepts:
    """ 
        Attributes:
            roles (list[str]):
            capabilities (list[str]):
     """

    roles: list[str]
    capabilities: list[str]





    def to_dict(self) -> dict[str, Any]:
        roles = self.roles



        capabilities = self.capabilities




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "roles": roles,
            "capabilities": capabilities,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        roles = cast(list[str], d.pop("roles"))


        capabilities = cast(list[str], d.pop("capabilities"))


        agent_handoff_accepts = cls(
            roles=roles,
            capabilities=capabilities,
        )

        return agent_handoff_accepts

