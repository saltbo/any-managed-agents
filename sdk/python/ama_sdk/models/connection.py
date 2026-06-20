from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.connection_approval_mode import ConnectionApprovalMode
from ..models.connection_state import ConnectionState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.connection_credential_ref import ConnectionCredentialRef
  from ..models.connection_last_error_type_0 import ConnectionLastErrorType0
  from ..models.connection_metadata import ConnectionMetadata





T = TypeVar("T", bound="Connection")



@_attrs_define
class Connection:
    """ 
        Attributes:
            id (str):
            project_id (str):
            connector_id (str):
            credential_ref (ConnectionCredentialRef):
            endpoint_url (None | str):
            approval_mode (ConnectionApprovalMode):
            state (ConnectionState):
            last_error (ConnectionLastErrorType0 | None):
            metadata (ConnectionMetadata):
            connected_at (datetime.datetime):
            disconnected_at (datetime.datetime | None):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    connector_id: str
    credential_ref: ConnectionCredentialRef
    endpoint_url: None | str
    approval_mode: ConnectionApprovalMode
    state: ConnectionState
    last_error: ConnectionLastErrorType0 | None
    metadata: ConnectionMetadata
    connected_at: datetime.datetime
    disconnected_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.connection_credential_ref import ConnectionCredentialRef
        from ..models.connection_last_error_type_0 import ConnectionLastErrorType0
        from ..models.connection_metadata import ConnectionMetadata
        id = self.id

        project_id = self.project_id

        connector_id = self.connector_id

        credential_ref = self.credential_ref.to_dict()

        endpoint_url: None | str
        endpoint_url = self.endpoint_url

        approval_mode = self.approval_mode.value

        state = self.state.value

        last_error: dict[str, Any] | None
        if isinstance(self.last_error, ConnectionLastErrorType0):
            last_error = self.last_error.to_dict()
        else:
            last_error = self.last_error

        metadata = self.metadata.to_dict()

        connected_at = self.connected_at.isoformat()

        disconnected_at: None | str
        if isinstance(self.disconnected_at, datetime.datetime):
            disconnected_at = self.disconnected_at.isoformat()
        else:
            disconnected_at = self.disconnected_at

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "connectorId": connector_id,
            "credentialRef": credential_ref,
            "endpointUrl": endpoint_url,
            "approvalMode": approval_mode,
            "state": state,
            "lastError": last_error,
            "metadata": metadata,
            "connectedAt": connected_at,
            "disconnectedAt": disconnected_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.connection_credential_ref import ConnectionCredentialRef
        from ..models.connection_last_error_type_0 import ConnectionLastErrorType0
        from ..models.connection_metadata import ConnectionMetadata
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        connector_id = d.pop("connectorId")

        credential_ref = ConnectionCredentialRef.from_dict(d.pop("credentialRef"))




        def _parse_endpoint_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        endpoint_url = _parse_endpoint_url(d.pop("endpointUrl"))


        approval_mode = ConnectionApprovalMode(d.pop("approvalMode"))




        state = ConnectionState(d.pop("state"))




        def _parse_last_error(data: object) -> ConnectionLastErrorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                last_error_type_0 = ConnectionLastErrorType0.from_dict(data)



                return last_error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ConnectionLastErrorType0 | None, data)

        last_error = _parse_last_error(d.pop("lastError"))


        metadata = ConnectionMetadata.from_dict(d.pop("metadata"))




        connected_at = datetime.datetime.fromisoformat(d.pop("connectedAt"))




        def _parse_disconnected_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                disconnected_at_type_0 = datetime.datetime.fromisoformat(data)



                return disconnected_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        disconnected_at = _parse_disconnected_at(d.pop("disconnectedAt"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        connection = cls(
            id=id,
            project_id=project_id,
            connector_id=connector_id,
            credential_ref=credential_ref,
            endpoint_url=endpoint_url,
            approval_mode=approval_mode,
            state=state,
            last_error=last_error,
            metadata=metadata,
            connected_at=connected_at,
            disconnected_at=disconnected_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        connection.additional_properties = d
        return connection

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
