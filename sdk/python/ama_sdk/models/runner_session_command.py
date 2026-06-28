from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_runtime_request import RunnerRuntimeRequest





T = TypeVar("T", bound="RunnerSessionCommand")



@_attrs_define
class RunnerSessionCommand:
    """ 
        Attributes:
            type_ (str):  Example: send.
            id (str | Unset):  Example: runnercmd_abc123.
            path (str | Unset):  Example: /rpc.
            message (str | Unset):  Example: continue.
            reason (str | Unset):  Example: user cancelled.
            permission_id (str | Unset):  Example: perm_abc123.
            allowed (bool | Unset):
            body (RunnerRuntimeRequest | Unset):
     """

    type_: str
    id: str | Unset = UNSET
    path: str | Unset = UNSET
    message: str | Unset = UNSET
    reason: str | Unset = UNSET
    permission_id: str | Unset = UNSET
    allowed: bool | Unset = UNSET
    body: RunnerRuntimeRequest | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_runtime_request import RunnerRuntimeRequest
        type_ = self.type_

        id = self.id

        path = self.path

        message = self.message

        reason = self.reason

        permission_id = self.permission_id

        allowed = self.allowed

        body: dict[str, Any] | Unset = UNSET
        if not isinstance(self.body, Unset):
            body = self.body.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
        })
        if id is not UNSET:
            field_dict["id"] = id
        if path is not UNSET:
            field_dict["path"] = path
        if message is not UNSET:
            field_dict["message"] = message
        if reason is not UNSET:
            field_dict["reason"] = reason
        if permission_id is not UNSET:
            field_dict["permissionId"] = permission_id
        if allowed is not UNSET:
            field_dict["allowed"] = allowed
        if body is not UNSET:
            field_dict["body"] = body

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_runtime_request import RunnerRuntimeRequest
        d = dict(src_dict)
        type_ = d.pop("type")

        id = d.pop("id", UNSET)

        path = d.pop("path", UNSET)

        message = d.pop("message", UNSET)

        reason = d.pop("reason", UNSET)

        permission_id = d.pop("permissionId", UNSET)

        allowed = d.pop("allowed", UNSET)

        _body = d.pop("body", UNSET)
        body: RunnerRuntimeRequest | Unset
        if isinstance(_body,  Unset):
            body = UNSET
        else:
            body = RunnerRuntimeRequest.from_dict(_body)




        runner_session_command = cls(
            type_=type_,
            id=id,
            path=path,
            message=message,
            reason=reason,
            permission_id=permission_id,
            allowed=allowed,
            body=body,
        )

        return runner_session_command

