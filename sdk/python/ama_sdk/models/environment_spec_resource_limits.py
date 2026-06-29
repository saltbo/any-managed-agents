from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="EnvironmentSpecResourceLimits")



@_attrs_define
class EnvironmentSpecResourceLimits:
    """ 
        Example:
            {'memoryMb': 512}

        Attributes:
            cpu_ms (int | Unset):
            memory_mb (int | Unset):
            timeout_seconds (int | Unset):
     """

    cpu_ms: int | Unset = UNSET
    memory_mb: int | Unset = UNSET
    timeout_seconds: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        cpu_ms = self.cpu_ms

        memory_mb = self.memory_mb

        timeout_seconds = self.timeout_seconds


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if cpu_ms is not UNSET:
            field_dict["cpuMs"] = cpu_ms
        if memory_mb is not UNSET:
            field_dict["memoryMb"] = memory_mb
        if timeout_seconds is not UNSET:
            field_dict["timeoutSeconds"] = timeout_seconds

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        cpu_ms = d.pop("cpuMs", UNSET)

        memory_mb = d.pop("memoryMb", UNSET)

        timeout_seconds = d.pop("timeoutSeconds", UNSET)

        environment_spec_resource_limits = cls(
            cpu_ms=cpu_ms,
            memory_mb=memory_mb,
            timeout_seconds=timeout_seconds,
        )

        return environment_spec_resource_limits

