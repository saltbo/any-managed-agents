from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast






T = TypeVar("T", bound="SessionAgentSnapshotHandoffAccepts")



@_attrs_define
class SessionAgentSnapshotHandoffAccepts:
    """ 
        Attributes:
            roles (list[str]):
            capabilities (list[str]):
     """

    roles: list[str]
    capabilities: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        roles = self.roles



        capabilities = self.capabilities




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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


        session_agent_snapshot_handoff_accepts = cls(
            roles=roles,
            capabilities=capabilities,
        )


        session_agent_snapshot_handoff_accepts.additional_properties = d
        return session_agent_snapshot_handoff_accepts

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
