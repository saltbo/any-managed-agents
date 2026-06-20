from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="PolicyDecision")



@_attrs_define
class PolicyDecision:
    """ 
        Attributes:
            allowed (bool):
            category (str):  Example: provider.
            rule (None | str):
            message (str):  Example: Allowed by effective policy..
     """

    allowed: bool
    category: str
    rule: None | str
    message: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        allowed = self.allowed

        category = self.category

        rule: None | str
        rule = self.rule

        message = self.message


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "allowed": allowed,
            "category": category,
            "rule": rule,
            "message": message,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        allowed = d.pop("allowed")

        category = d.pop("category")

        def _parse_rule(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        rule = _parse_rule(d.pop("rule"))


        message = d.pop("message")

        policy_decision = cls(
            allowed=allowed,
            category=category,
            rule=rule,
            message=message,
        )


        policy_decision.additional_properties = d
        return policy_decision

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
