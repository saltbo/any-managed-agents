from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.connection_tool_approval_mode import ConnectionToolApprovalMode
from ..models.connection_tool_availability import ConnectionToolAvailability
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.connection_tool_input_schema import ConnectionToolInputSchema
  from ..models.connection_tool_policy_metadata import ConnectionToolPolicyMetadata





T = TypeVar("T", bound="ConnectionTool")



@_attrs_define
class ConnectionTool:
    """ 
        Attributes:
            id (str):
            connection_id (str):
            connector_id (str):
            name (str):
            description (None | str):
            input_schema (ConnectionToolInputSchema):
            approval_mode (ConnectionToolApprovalMode):
            policy_metadata (ConnectionToolPolicyMetadata):
            availability (ConnectionToolAvailability):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    connection_id: str
    connector_id: str
    name: str
    description: None | str
    input_schema: ConnectionToolInputSchema
    approval_mode: ConnectionToolApprovalMode
    policy_metadata: ConnectionToolPolicyMetadata
    availability: ConnectionToolAvailability
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.connection_tool_input_schema import ConnectionToolInputSchema
        from ..models.connection_tool_policy_metadata import ConnectionToolPolicyMetadata
        id = self.id

        connection_id = self.connection_id

        connector_id = self.connector_id

        name = self.name

        description: None | str
        description = self.description

        input_schema = self.input_schema.to_dict()

        approval_mode = self.approval_mode.value

        policy_metadata = self.policy_metadata.to_dict()

        availability = self.availability.value

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "connectionId": connection_id,
            "connectorId": connector_id,
            "name": name,
            "description": description,
            "inputSchema": input_schema,
            "approvalMode": approval_mode,
            "policyMetadata": policy_metadata,
            "availability": availability,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.connection_tool_input_schema import ConnectionToolInputSchema
        from ..models.connection_tool_policy_metadata import ConnectionToolPolicyMetadata
        d = dict(src_dict)
        id = d.pop("id")

        connection_id = d.pop("connectionId")

        connector_id = d.pop("connectorId")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))


        input_schema = ConnectionToolInputSchema.from_dict(d.pop("inputSchema"))




        approval_mode = ConnectionToolApprovalMode(d.pop("approvalMode"))




        policy_metadata = ConnectionToolPolicyMetadata.from_dict(d.pop("policyMetadata"))




        availability = ConnectionToolAvailability(d.pop("availability"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        connection_tool = cls(
            id=id,
            connection_id=connection_id,
            connector_id=connector_id,
            name=name,
            description=description,
            input_schema=input_schema,
            approval_mode=approval_mode,
            policy_metadata=policy_metadata,
            availability=availability,
            created_at=created_at,
            updated_at=updated_at,
        )


        connection_tool.additional_properties = d
        return connection_tool

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
