from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_approval_frame_decision import SessionApprovalFrameDecision
from ..models.session_approval_frame_type import SessionApprovalFrameType
from ..types import UNSET, Unset






T = TypeVar("T", bound="SessionApprovalFrame")



@_attrs_define
class SessionApprovalFrame:
    """ 
        Attributes:
            type_ (SessionApprovalFrameType):
            approval_id (str):
            decision (SessionApprovalFrameDecision):
            reason (str | Unset):
     """

    type_: SessionApprovalFrameType
    approval_id: str
    decision: SessionApprovalFrameDecision
    reason: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        approval_id = self.approval_id

        decision = self.decision.value

        reason = self.reason


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "approvalId": approval_id,
            "decision": decision,
        })
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionApprovalFrameType(d.pop("type"))




        approval_id = d.pop("approvalId")

        decision = SessionApprovalFrameDecision(d.pop("decision"))




        reason = d.pop("reason", UNSET)

        session_approval_frame = cls(
            type_=type_,
            approval_id=approval_id,
            decision=decision,
            reason=reason,
        )


        session_approval_frame.additional_properties = d
        return session_approval_frame

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
