from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.session_agent_snapshot_handoff_accepts import SessionAgentSnapshotHandoffAccepts
  from ..models.session_agent_snapshot_handoff_targets_item import SessionAgentSnapshotHandoffTargetsItem





T = TypeVar("T", bound="SessionAgentSnapshotHandoff")



@_attrs_define
class SessionAgentSnapshotHandoff:
    """ 
        Attributes:
            enabled (bool):
            accepts (SessionAgentSnapshotHandoffAccepts):
            targets (list[SessionAgentSnapshotHandoffTargetsItem]):
     """

    enabled: bool
    accepts: SessionAgentSnapshotHandoffAccepts
    targets: list[SessionAgentSnapshotHandoffTargetsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_agent_snapshot_handoff_accepts import SessionAgentSnapshotHandoffAccepts
        from ..models.session_agent_snapshot_handoff_targets_item import SessionAgentSnapshotHandoffTargetsItem
        enabled = self.enabled

        accepts = self.accepts.to_dict()

        targets = []
        for targets_item_data in self.targets:
            targets_item = targets_item_data.to_dict()
            targets.append(targets_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "enabled": enabled,
            "accepts": accepts,
            "targets": targets,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_agent_snapshot_handoff_accepts import SessionAgentSnapshotHandoffAccepts
        from ..models.session_agent_snapshot_handoff_targets_item import SessionAgentSnapshotHandoffTargetsItem
        d = dict(src_dict)
        enabled = d.pop("enabled")

        accepts = SessionAgentSnapshotHandoffAccepts.from_dict(d.pop("accepts"))




        targets = []
        _targets = d.pop("targets")
        for targets_item_data in (_targets):
            targets_item = SessionAgentSnapshotHandoffTargetsItem.from_dict(targets_item_data)



            targets.append(targets_item)


        session_agent_snapshot_handoff = cls(
            enabled=enabled,
            accepts=accepts,
            targets=targets,
        )


        session_agent_snapshot_handoff.additional_properties = d
        return session_agent_snapshot_handoff

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
