from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.agent_handoff_target import AgentHandoffTarget





T = TypeVar("T", bound="AgentHandoffPolicy")



@_attrs_define
class AgentHandoffPolicy:
    """ 
        Attributes:
            enabled (bool | Unset):
            targets (list[AgentHandoffTarget] | Unset):
     """

    enabled: bool | Unset = UNSET
    targets: list[AgentHandoffTarget] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_handoff_target import AgentHandoffTarget
        enabled = self.enabled

        targets: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.targets, Unset):
            targets = []
            for targets_item_data in self.targets:
                targets_item = targets_item_data.to_dict()
                targets.append(targets_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if targets is not UNSET:
            field_dict["targets"] = targets

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_handoff_target import AgentHandoffTarget
        d = dict(src_dict)
        enabled = d.pop("enabled", UNSET)

        _targets = d.pop("targets", UNSET)
        targets: list[AgentHandoffTarget] | Unset = UNSET
        if _targets is not UNSET:
            targets = []
            for targets_item_data in _targets:
                targets_item = AgentHandoffTarget.from_dict(targets_item_data)



                targets.append(targets_item)


        agent_handoff_policy = cls(
            enabled=enabled,
            targets=targets,
        )


        agent_handoff_policy.additional_properties = d
        return agent_handoff_policy

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
