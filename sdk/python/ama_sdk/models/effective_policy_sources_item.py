from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="EffectivePolicySourcesItem")



@_attrs_define
class EffectivePolicySourcesItem:
    """ 
        Attributes:
            scope (str):
            id (str):
            team_id (None | str):
     """

    scope: str
    id: str
    team_id: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        scope = self.scope

        id = self.id

        team_id: None | str
        team_id = self.team_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "scope": scope,
            "id": id,
            "teamId": team_id,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        scope = d.pop("scope")

        id = d.pop("id")

        def _parse_team_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        team_id = _parse_team_id(d.pop("teamId"))


        effective_policy_sources_item = cls(
            scope=scope,
            id=id,
            team_id=team_id,
        )


        effective_policy_sources_item.additional_properties = d
        return effective_policy_sources_item

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
