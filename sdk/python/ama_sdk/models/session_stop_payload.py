from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="SessionStopPayload")



@_attrs_define
class SessionStopPayload:
    """ 
        Attributes:
            reason (str | Unset):
     """

    reason: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        reason = self.reason


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason", UNSET)

        session_stop_payload = cls(
            reason=reason,
        )

        return session_stop_payload

