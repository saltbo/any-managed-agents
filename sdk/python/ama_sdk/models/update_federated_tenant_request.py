from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_federated_tenant_request_metadata import UpdateFederatedTenantRequestMetadata





T = TypeVar("T", bound="UpdateFederatedTenantRequest")



@_attrs_define
class UpdateFederatedTenantRequest:
    """ 
        Attributes:
            enabled (bool | Unset):
            capabilities (list[str] | Unset):  Example: ['session:poll'].
            environment_id (None | str | Unset):  Example: env_abc123.
            metadata (UpdateFederatedTenantRequestMetadata | Unset):  Example: {'platform': 'agent-kanban'}.
     """

    enabled: bool | Unset = UNSET
    capabilities: list[str] | Unset = UNSET
    environment_id: None | str | Unset = UNSET
    metadata: UpdateFederatedTenantRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_federated_tenant_request_metadata import UpdateFederatedTenantRequestMetadata
        enabled = self.enabled

        capabilities: list[str] | Unset = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities



        environment_id: None | str | Unset
        if isinstance(self.environment_id, Unset):
            environment_id = UNSET
        else:
            environment_id = self.environment_id

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_federated_tenant_request_metadata import UpdateFederatedTenantRequestMetadata
        d = dict(src_dict)
        enabled = d.pop("enabled", UNSET)

        capabilities = cast(list[str], d.pop("capabilities", UNSET))


        def _parse_environment_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        environment_id = _parse_environment_id(d.pop("environmentId", UNSET))


        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateFederatedTenantRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateFederatedTenantRequestMetadata.from_dict(_metadata)




        update_federated_tenant_request = cls(
            enabled=enabled,
            capabilities=capabilities,
            environment_id=environment_id,
            metadata=metadata,
        )

        return update_federated_tenant_request

