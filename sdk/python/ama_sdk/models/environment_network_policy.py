from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_network_policy_mode import EnvironmentNetworkPolicyMode
from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="EnvironmentNetworkPolicy")



@_attrs_define
class EnvironmentNetworkPolicy:
    """ 
        Example:
            {'mode': 'restricted', 'allowedHosts': ['registry.npmjs.org']}

        Attributes:
            mode (EnvironmentNetworkPolicyMode):
            allowed_hosts (list[str] | Unset):
     """

    mode: EnvironmentNetworkPolicyMode
    allowed_hosts: list[str] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        mode = self.mode.value

        allowed_hosts: list[str] | Unset = UNSET
        if not isinstance(self.allowed_hosts, Unset):
            allowed_hosts = self.allowed_hosts




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "mode": mode,
        })
        if allowed_hosts is not UNSET:
            field_dict["allowedHosts"] = allowed_hosts

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = EnvironmentNetworkPolicyMode(d.pop("mode"))




        allowed_hosts = cast(list[str], d.pop("allowedHosts", UNSET))


        environment_network_policy = cls(
            mode=mode,
            allowed_hosts=allowed_hosts,
        )

        return environment_network_policy

