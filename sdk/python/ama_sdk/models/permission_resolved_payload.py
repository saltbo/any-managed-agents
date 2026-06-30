from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.event_tool_call import EventToolCall
  from ..models.permission_resolved_payload_details import PermissionResolvedPayloadDetails





T = TypeVar("T", bound="PermissionResolvedPayload")



@_attrs_define
class PermissionResolvedPayload:
    """ 
        Attributes:
            allowed (bool):
            permission_id (str | Unset):
            reason (str | Unset):
            tool_call (EventToolCall | Unset):
            details (PermissionResolvedPayloadDetails | Unset):
     """

    allowed: bool
    permission_id: str | Unset = UNSET
    reason: str | Unset = UNSET
    tool_call: EventToolCall | Unset = UNSET
    details: PermissionResolvedPayloadDetails | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_tool_call import EventToolCall
        from ..models.permission_resolved_payload_details import PermissionResolvedPayloadDetails
        allowed = self.allowed

        permission_id = self.permission_id

        reason = self.reason

        tool_call: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_call, Unset):
            tool_call = self.tool_call.to_dict()

        details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "allowed": allowed,
        })
        if permission_id is not UNSET:
            field_dict["permissionId"] = permission_id
        if reason is not UNSET:
            field_dict["reason"] = reason
        if tool_call is not UNSET:
            field_dict["toolCall"] = tool_call
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tool_call import EventToolCall
        from ..models.permission_resolved_payload_details import PermissionResolvedPayloadDetails
        d = dict(src_dict)
        allowed = d.pop("allowed")

        permission_id = d.pop("permissionId", UNSET)

        reason = d.pop("reason", UNSET)

        _tool_call = d.pop("toolCall", UNSET)
        tool_call: EventToolCall | Unset
        if isinstance(_tool_call,  Unset):
            tool_call = UNSET
        else:
            tool_call = EventToolCall.from_dict(_tool_call)




        _details = d.pop("details", UNSET)
        details: PermissionResolvedPayloadDetails | Unset
        if isinstance(_details,  Unset):
            details = UNSET
        else:
            details = PermissionResolvedPayloadDetails.from_dict(_details)




        permission_resolved_payload = cls(
            allowed=allowed,
            permission_id=permission_id,
            reason=reason,
            tool_call=tool_call,
            details=details,
        )

        return permission_resolved_payload

