from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_federated_tenant_request_metadata import CreateFederatedTenantRequestMetadata





T = TypeVar("T", bound="CreateFederatedTenantRequest")



@_attrs_define
class CreateFederatedTenantRequest:
    """ 
        Attributes:
            issuer (str):  Example: https://ak.example.com.
            external_tenant_id (str):  Example: org_abc123.
            environment_id (str | Unset):  Example: env_abc123.
            capabilities (list[str] | Unset):  Example: ['session:poll', 'session:claim'].
            metadata (CreateFederatedTenantRequestMetadata | Unset):  Example: {'platform': 'agent-kanban'}.
     """

    issuer: str
    external_tenant_id: str
    environment_id: str | Unset = UNSET
    capabilities: list[str] | Unset = UNSET
    metadata: CreateFederatedTenantRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_federated_tenant_request_metadata import CreateFederatedTenantRequestMetadata
        issuer = self.issuer

        external_tenant_id = self.external_tenant_id

        environment_id = self.environment_id

        capabilities: list[str] | Unset = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities



        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "issuer": issuer,
            "externalTenantId": external_tenant_id,
        })
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_federated_tenant_request_metadata import CreateFederatedTenantRequestMetadata
        d = dict(src_dict)
        issuer = d.pop("issuer")

        external_tenant_id = d.pop("externalTenantId")

        environment_id = d.pop("environmentId", UNSET)

        capabilities = cast(list[str], d.pop("capabilities", UNSET))


        _metadata = d.pop("metadata", UNSET)
        metadata: CreateFederatedTenantRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateFederatedTenantRequestMetadata.from_dict(_metadata)




        create_federated_tenant_request = cls(
            issuer=issuer,
            external_tenant_id=external_tenant_id,
            environment_id=environment_id,
            capabilities=capabilities,
            metadata=metadata,
        )

        return create_federated_tenant_request

