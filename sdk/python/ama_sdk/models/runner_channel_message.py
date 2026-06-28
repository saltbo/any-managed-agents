from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_sandbox_request import RunnerSandboxRequest
  from ..models.runner_session_command import RunnerSessionCommand





T = TypeVar("T", bound="RunnerChannelMessage")



@_attrs_define
class RunnerChannelMessage:
    """ 
        Attributes:
            type_ (str):  Example: session.command.
            event_id (str | Unset):
            request_id (str | Unset):
            message (str | Unset):
            session_id (str | Unset):  Example: session_abc123.
            runner_id (str | Unset):  Example: runner_abc123.
            lease_id (str | Unset):  Example: lease_abc123.
            work_item_id (str | Unset):  Example: work_abc123.
            command (RunnerSessionCommand | Unset):
            request (RunnerSandboxRequest | Unset):
     """

    type_: str
    event_id: str | Unset = UNSET
    request_id: str | Unset = UNSET
    message: str | Unset = UNSET
    session_id: str | Unset = UNSET
    runner_id: str | Unset = UNSET
    lease_id: str | Unset = UNSET
    work_item_id: str | Unset = UNSET
    command: RunnerSessionCommand | Unset = UNSET
    request: RunnerSandboxRequest | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_sandbox_request import RunnerSandboxRequest
        from ..models.runner_session_command import RunnerSessionCommand
        type_ = self.type_

        event_id = self.event_id

        request_id = self.request_id

        message = self.message

        session_id = self.session_id

        runner_id = self.runner_id

        lease_id = self.lease_id

        work_item_id = self.work_item_id

        command: dict[str, Any] | Unset = UNSET
        if not isinstance(self.command, Unset):
            command = self.command.to_dict()

        request: dict[str, Any] | Unset = UNSET
        if not isinstance(self.request, Unset):
            request = self.request.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
        })
        if event_id is not UNSET:
            field_dict["eventId"] = event_id
        if request_id is not UNSET:
            field_dict["requestId"] = request_id
        if message is not UNSET:
            field_dict["message"] = message
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id
        if runner_id is not UNSET:
            field_dict["runnerId"] = runner_id
        if lease_id is not UNSET:
            field_dict["leaseId"] = lease_id
        if work_item_id is not UNSET:
            field_dict["workItemId"] = work_item_id
        if command is not UNSET:
            field_dict["command"] = command
        if request is not UNSET:
            field_dict["request"] = request

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_sandbox_request import RunnerSandboxRequest
        from ..models.runner_session_command import RunnerSessionCommand
        d = dict(src_dict)
        type_ = d.pop("type")

        event_id = d.pop("eventId", UNSET)

        request_id = d.pop("requestId", UNSET)

        message = d.pop("message", UNSET)

        session_id = d.pop("sessionId", UNSET)

        runner_id = d.pop("runnerId", UNSET)

        lease_id = d.pop("leaseId", UNSET)

        work_item_id = d.pop("workItemId", UNSET)

        _command = d.pop("command", UNSET)
        command: RunnerSessionCommand | Unset
        if isinstance(_command,  Unset):
            command = UNSET
        else:
            command = RunnerSessionCommand.from_dict(_command)




        _request = d.pop("request", UNSET)
        request: RunnerSandboxRequest | Unset
        if isinstance(_request,  Unset):
            request = UNSET
        else:
            request = RunnerSandboxRequest.from_dict(_request)




        runner_channel_message = cls(
            type_=type_,
            event_id=event_id,
            request_id=request_id,
            message=message,
            session_id=session_id,
            runner_id=runner_id,
            lease_id=lease_id,
            work_item_id=work_item_id,
            command=command,
            request=request,
        )

        return runner_channel_message

