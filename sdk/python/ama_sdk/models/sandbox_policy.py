from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="SandboxPolicy")



@_attrs_define
class SandboxPolicy:
    """ 
        Attributes:
            enabled (bool | Unset):
            status (str | Unset):
            network (bool | str | Unset):
            allowed_hosts (list[str] | Unset):
            blocked_commands (list[str] | Unset):
            allowed_commands (list[str] | Unset):
     """

    enabled: bool | Unset = UNSET
    status: str | Unset = UNSET
    network: bool | str | Unset = UNSET
    allowed_hosts: list[str] | Unset = UNSET
    blocked_commands: list[str] | Unset = UNSET
    allowed_commands: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        status = self.status

        network: bool | str | Unset
        if isinstance(self.network, Unset):
            network = UNSET
        else:
            network = self.network

        allowed_hosts: list[str] | Unset = UNSET
        if not isinstance(self.allowed_hosts, Unset):
            allowed_hosts = self.allowed_hosts



        blocked_commands: list[str] | Unset = UNSET
        if not isinstance(self.blocked_commands, Unset):
            blocked_commands = self.blocked_commands



        allowed_commands: list[str] | Unset = UNSET
        if not isinstance(self.allowed_commands, Unset):
            allowed_commands = self.allowed_commands




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if status is not UNSET:
            field_dict["status"] = status
        if network is not UNSET:
            field_dict["network"] = network
        if allowed_hosts is not UNSET:
            field_dict["allowedHosts"] = allowed_hosts
        if blocked_commands is not UNSET:
            field_dict["blockedCommands"] = blocked_commands
        if allowed_commands is not UNSET:
            field_dict["allowedCommands"] = allowed_commands

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        enabled = d.pop("enabled", UNSET)

        status = d.pop("status", UNSET)

        def _parse_network(data: object) -> bool | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(bool | str | Unset, data)

        network = _parse_network(d.pop("network", UNSET))


        allowed_hosts = cast(list[str], d.pop("allowedHosts", UNSET))


        blocked_commands = cast(list[str], d.pop("blockedCommands", UNSET))


        allowed_commands = cast(list[str], d.pop("allowedCommands", UNSET))


        sandbox_policy = cls(
            enabled=enabled,
            status=status,
            network=network,
            allowed_hosts=allowed_hosts,
            blocked_commands=blocked_commands,
            allowed_commands=allowed_commands,
        )


        sandbox_policy.additional_properties = d
        return sandbox_policy

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
