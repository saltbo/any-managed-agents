from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_runtime_inventory_state import RunnerRuntimeInventoryState
from ..types import UNSET, Unset






T = TypeVar("T", bound="RunnerRuntimeInventory")



@_attrs_define
class RunnerRuntimeInventory:
    """ 
        Attributes:
            runtime (str):  Example: codex.
            state (RunnerRuntimeInventoryState):  Example: ready.
            version (str | Unset):  Example: 0.42.0.
            detail (str | Unset):  Example: host CLI enumerated 2 models.
     """

    runtime: str
    state: RunnerRuntimeInventoryState
    version: str | Unset = UNSET
    detail: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        runtime = self.runtime

        state = self.state.value

        version = self.version

        detail = self.detail


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "runtime": runtime,
            "state": state,
        })
        if version is not UNSET:
            field_dict["version"] = version
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        runtime = d.pop("runtime")

        state = RunnerRuntimeInventoryState(d.pop("state"))




        version = d.pop("version", UNSET)

        detail = d.pop("detail", UNSET)

        runner_runtime_inventory = cls(
            runtime=runtime,
            state=state,
            version=version,
            detail=detail,
        )

        return runner_runtime_inventory

