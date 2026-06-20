from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.trigger_run_state import TriggerRunState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.trigger_run_metadata import TriggerRunMetadata





T = TypeVar("T", bound="TriggerRun")



@_attrs_define
class TriggerRun:
    """ 
        Attributes:
            id (str):  Example: trigrun_abc123.
            project_id (str):  Example: project_abc123.
            trigger_id (str):  Example: trigger_abc123.
            scheduled_for (datetime.datetime):  Example: 2026-05-26T12:00:00.000Z.
            heartbeat_at (datetime.datetime):  Example: 2026-05-26T12:01:00.000Z.
            state (TriggerRunState):  Example: session_created.
            idempotency_key (str):  Example: trigger_abc123:2026-05-26T12:00:00.000Z.
            session_id (None | str):  Example: session_abc123.
            correlation_id (str):  Example: schedule:trigger_abc123:2026-05-26T12:00:00.000Z.
            error_message (None | str):
            metadata (TriggerRunMetadata):  Example: {'source': 'trigger'}.
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    trigger_id: str
    scheduled_for: datetime.datetime
    heartbeat_at: datetime.datetime
    state: TriggerRunState
    idempotency_key: str
    session_id: None | str
    correlation_id: str
    error_message: None | str
    metadata: TriggerRunMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.trigger_run_metadata import TriggerRunMetadata
        id = self.id

        project_id = self.project_id

        trigger_id = self.trigger_id

        scheduled_for = self.scheduled_for.isoformat()

        heartbeat_at = self.heartbeat_at.isoformat()

        state = self.state.value

        idempotency_key = self.idempotency_key

        session_id: None | str
        session_id = self.session_id

        correlation_id = self.correlation_id

        error_message: None | str
        error_message = self.error_message

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "triggerId": trigger_id,
            "scheduledFor": scheduled_for,
            "heartbeatAt": heartbeat_at,
            "state": state,
            "idempotencyKey": idempotency_key,
            "sessionId": session_id,
            "correlationId": correlation_id,
            "errorMessage": error_message,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trigger_run_metadata import TriggerRunMetadata
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        trigger_id = d.pop("triggerId")

        scheduled_for = datetime.datetime.fromisoformat(d.pop("scheduledFor"))




        heartbeat_at = datetime.datetime.fromisoformat(d.pop("heartbeatAt"))




        state = TriggerRunState(d.pop("state"))




        idempotency_key = d.pop("idempotencyKey")

        def _parse_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        session_id = _parse_session_id(d.pop("sessionId"))


        correlation_id = d.pop("correlationId")

        def _parse_error_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error_message = _parse_error_message(d.pop("errorMessage"))


        metadata = TriggerRunMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        trigger_run = cls(
            id=id,
            project_id=project_id,
            trigger_id=trigger_id,
            scheduled_for=scheduled_for,
            heartbeat_at=heartbeat_at,
            state=state,
            idempotency_key=idempotency_key,
            session_id=session_id,
            correlation_id=correlation_id,
            error_message=error_message,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        trigger_run.additional_properties = d
        return trigger_run

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
