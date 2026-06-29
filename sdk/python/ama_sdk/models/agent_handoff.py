from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.agent_handoff_accepts import AgentHandoffAccepts
  from ..models.agent_handoff_target import AgentHandoffTarget





T = TypeVar("T", bound="AgentHandoff")



@_attrs_define
class AgentHandoff:
    """ 
        Attributes:
            enabled (bool):
            accepts (AgentHandoffAccepts):
            targets (list[AgentHandoffTarget]):
     """

    enabled: bool
    accepts: AgentHandoffAccepts
    targets: list[AgentHandoffTarget]





    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_handoff_accepts import AgentHandoffAccepts
        from ..models.agent_handoff_target import AgentHandoffTarget
        enabled = self.enabled

        accepts = self.accepts.to_dict()

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "enabled": enabled,
            "accepts": accepts,
            "targets": targets,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_handoff_accepts import AgentHandoffAccepts
        from ..models.agent_handoff_target import AgentHandoffTarget
        d = dict(src_dict)
        enabled = d.pop("enabled")

        accepts = AgentHandoffAccepts.from_dict(d.pop("accepts"))




        targets = []
        _targets = d.pop("targets")
        for targets_item_data in (_targets):
            targets_item = AgentHandoffTarget.from_dict(targets_item_data)



            targets.append(targets_item)


        agent_handoff = cls(
            enabled=enabled,
            accepts=accepts,
            targets=targets,
        )

        return agent_handoff

