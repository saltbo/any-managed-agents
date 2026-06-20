from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_event_type import SessionEventType
from ..models.session_event_visibility import SessionEventVisibility
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.session_event_metadata import SessionEventMetadata
  from ..models.session_event_payload import SessionEventPayload





T = TypeVar("T", bound="SessionEvent")



@_attrs_define
class SessionEvent:
    """ 
        Attributes:
            id (str):
            project_id (str):
            session_id (str):
            sequence (int):
            type_ (SessionEventType):
            visibility (SessionEventVisibility):
            role (None | str):
            parent_event_id (None | str):
            correlation_id (None | str):
            payload (SessionEventPayload):
            metadata (SessionEventMetadata):
            created_at (datetime.datetime):
     """

    id: str
    project_id: str
    session_id: str
    sequence: int
    type_: SessionEventType
    visibility: SessionEventVisibility
    role: None | str
    parent_event_id: None | str
    correlation_id: None | str
    payload: SessionEventPayload
    metadata: SessionEventMetadata
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_event_metadata import SessionEventMetadata
        from ..models.session_event_payload import SessionEventPayload
        id = self.id

        project_id = self.project_id

        session_id = self.session_id

        sequence = self.sequence

        type_ = self.type_.value

        visibility = self.visibility.value

        role: None | str
        role = self.role

        parent_event_id: None | str
        parent_event_id = self.parent_event_id

        correlation_id: None | str
        correlation_id = self.correlation_id

        payload = self.payload.to_dict()

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "sessionId": session_id,
            "sequence": sequence,
            "type": type_,
            "visibility": visibility,
            "role": role,
            "parentEventId": parent_event_id,
            "correlationId": correlation_id,
            "payload": payload,
            "metadata": metadata,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_event_metadata import SessionEventMetadata
        from ..models.session_event_payload import SessionEventPayload
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        session_id = d.pop("sessionId")

        sequence = d.pop("sequence")

        type_ = SessionEventType(d.pop("type"))




        visibility = SessionEventVisibility(d.pop("visibility"))




        def _parse_role(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        role = _parse_role(d.pop("role"))


        def _parse_parent_event_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        parent_event_id = _parse_parent_event_id(d.pop("parentEventId"))


        def _parse_correlation_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        correlation_id = _parse_correlation_id(d.pop("correlationId"))


        payload = SessionEventPayload.from_dict(d.pop("payload"))




        metadata = SessionEventMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        session_event = cls(
            id=id,
            project_id=project_id,
            session_id=session_id,
            sequence=sequence,
            type_=type_,
            visibility=visibility,
            role=role,
            parent_event_id=parent_event_id,
            correlation_id=correlation_id,
            payload=payload,
            metadata=metadata,
            created_at=created_at,
        )


        session_event.additional_properties = d
        return session_event

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
