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
  from ..models.permission_request_payload_details import PermissionRequestPayloadDetails





T = TypeVar("T", bound="PermissionRequestPayload")



@_attrs_define
class PermissionRequestPayload:
    """ 
        Attributes:
            permission_id (str | Unset):
            command (str | Unset):
            tool_call (EventToolCall | Unset):
            details (PermissionRequestPayloadDetails | Unset):
     """

    permission_id: str | Unset = UNSET
    command: str | Unset = UNSET
    tool_call: EventToolCall | Unset = UNSET
    details: PermissionRequestPayloadDetails | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.event_tool_call import EventToolCall
        from ..models.permission_request_payload_details import PermissionRequestPayloadDetails
        permission_id = self.permission_id

        command = self.command

        tool_call: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_call, Unset):
            tool_call = self.tool_call.to_dict()

        details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if permission_id is not UNSET:
            field_dict["permissionId"] = permission_id
        if command is not UNSET:
            field_dict["command"] = command
        if tool_call is not UNSET:
            field_dict["toolCall"] = tool_call
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_tool_call import EventToolCall
        from ..models.permission_request_payload_details import PermissionRequestPayloadDetails
        d = dict(src_dict)
        permission_id = d.pop("permissionId", UNSET)

        command = d.pop("command", UNSET)

        _tool_call = d.pop("toolCall", UNSET)
        tool_call: EventToolCall | Unset
        if isinstance(_tool_call,  Unset):
            tool_call = UNSET
        else:
            tool_call = EventToolCall.from_dict(_tool_call)




        _details = d.pop("details", UNSET)
        details: PermissionRequestPayloadDetails | Unset
        if isinstance(_details,  Unset):
            details = UNSET
        else:
            details = PermissionRequestPayloadDetails.from_dict(_details)




        permission_request_payload = cls(
            permission_id=permission_id,
            command=command,
            tool_call=tool_call,
            details=details,
        )

        return permission_request_payload

