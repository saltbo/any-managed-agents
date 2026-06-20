from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.policy_scope_level import PolicyScopeLevel
from ..types import UNSET, Unset






T = TypeVar("T", bound="PolicyScope")



@_attrs_define
class PolicyScope:
    """ 
        Attributes:
            level (PolicyScopeLevel):  Example: project.
            team_id (str | Unset):  Example: team_platform.
     """

    level: PolicyScopeLevel
    team_id: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        level = self.level.value

        team_id = self.team_id


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "level": level,
        })
        if team_id is not UNSET:
            field_dict["teamId"] = team_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        level = PolicyScopeLevel(d.pop("level"))




        team_id = d.pop("teamId", UNSET)

        policy_scope = cls(
            level=level,
            team_id=team_id,
        )

        return policy_scope

