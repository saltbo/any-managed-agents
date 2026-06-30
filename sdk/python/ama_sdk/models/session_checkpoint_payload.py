from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="SessionCheckpointPayload")



@_attrs_define
class SessionCheckpointPayload:
    """ 
        Attributes:
            resume_token_ref (str | Unset):
            scope (str | Unset):
     """

    resume_token_ref: str | Unset = UNSET
    scope: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        resume_token_ref = self.resume_token_ref

        scope = self.scope


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if resume_token_ref is not UNSET:
            field_dict["resumeTokenRef"] = resume_token_ref
        if scope is not UNSET:
            field_dict["scope"] = scope

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resume_token_ref = d.pop("resumeTokenRef", UNSET)

        scope = d.pop("scope", UNSET)

        session_checkpoint_payload = cls(
            resume_token_ref=resume_token_ref,
            scope=scope,
        )

        return session_checkpoint_payload

