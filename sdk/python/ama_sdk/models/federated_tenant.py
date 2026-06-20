from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.federated_tenant_metadata import FederatedTenantMetadata





T = TypeVar("T", bound="FederatedTenant")



@_attrs_define
class FederatedTenant:
    """ 
        Attributes:
            id (str):  Example: ftn_abc123.
            issuer (str):  Example: https://ak.example.com.
            external_tenant_id (str):  Example: org_abc123.
            project_id (str):  Example: project_abc123.
            environment_id (None | str):  Example: env_abc123.
            capabilities (list[str]):  Example: ['session:poll', 'session:claim'].
            enabled (bool):  Example: True.
            metadata (FederatedTenantMetadata):  Example: {'platform': 'agent-kanban'}.
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    issuer: str
    external_tenant_id: str
    project_id: str
    environment_id: None | str
    capabilities: list[str]
    enabled: bool
    metadata: FederatedTenantMetadata
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.federated_tenant_metadata import FederatedTenantMetadata
        id = self.id

        issuer = self.issuer

        external_tenant_id = self.external_tenant_id

        project_id = self.project_id

        environment_id: None | str
        environment_id = self.environment_id

        capabilities = self.capabilities



        enabled = self.enabled

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "issuer": issuer,
            "externalTenantId": external_tenant_id,
            "projectId": project_id,
            "environmentId": environment_id,
            "capabilities": capabilities,
            "enabled": enabled,
            "metadata": metadata,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.federated_tenant_metadata import FederatedTenantMetadata
        d = dict(src_dict)
        id = d.pop("id")

        issuer = d.pop("issuer")

        external_tenant_id = d.pop("externalTenantId")

        project_id = d.pop("projectId")

        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        capabilities = cast(list[str], d.pop("capabilities"))


        enabled = d.pop("enabled")

        metadata = FederatedTenantMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        federated_tenant = cls(
            id=id,
            issuer=issuer,
            external_tenant_id=external_tenant_id,
            project_id=project_id,
            environment_id=environment_id,
            capabilities=capabilities,
            enabled=enabled,
            metadata=metadata,
            created_at=created_at,
            updated_at=updated_at,
        )


        federated_tenant.additional_properties = d
        return federated_tenant

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
