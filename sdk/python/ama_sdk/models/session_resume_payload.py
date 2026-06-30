from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="SessionResumePayload")



@_attrs_define
class SessionResumePayload:
    """ 
        Attributes:
            from_checkpoint (str | Unset):
            reason (str | Unset):
     """

    from_checkpoint: str | Unset = UNSET
    reason: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from_checkpoint = self.from_checkpoint

        reason = self.reason


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if from_checkpoint is not UNSET:
            field_dict["fromCheckpoint"] = from_checkpoint
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        from_checkpoint = d.pop("fromCheckpoint", UNSET)

        reason = d.pop("reason", UNSET)

        session_resume_payload = cls(
            from_checkpoint=from_checkpoint,
            reason=reason,
        )

        return session_resume_payload

