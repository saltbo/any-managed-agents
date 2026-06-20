from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_credential_request_connector_binding import CreateVaultCredentialRequestConnectorBinding
  from ..models.create_vault_credential_request_metadata import CreateVaultCredentialRequestMetadata
  from ..models.create_vault_credential_request_secret import CreateVaultCredentialRequestSecret





T = TypeVar("T", bound="CreateVaultCredentialRequest")



@_attrs_define
class CreateVaultCredentialRequest:
    """ 
        Attributes:
            name (str):  Example: Workers AI token.
            type_ (str):  Example: api_key.
            secret (CreateVaultCredentialRequestSecret):  Example: {'provider': 'cloudflare-secrets', 'secretValue': 'input-
                only'}.
            connector_binding (CreateVaultCredentialRequestConnectorBinding | Unset):  Example: {'connectorId': 'workers-
                ai', 'name': 'apiKey'}.
            metadata (CreateVaultCredentialRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    name: str
    type_: str
    secret: CreateVaultCredentialRequestSecret
    connector_binding: CreateVaultCredentialRequestConnectorBinding | Unset = UNSET
    metadata: CreateVaultCredentialRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_credential_request_connector_binding import CreateVaultCredentialRequestConnectorBinding
        from ..models.create_vault_credential_request_metadata import CreateVaultCredentialRequestMetadata
        from ..models.create_vault_credential_request_secret import CreateVaultCredentialRequestSecret
        name = self.name

        type_ = self.type_

        secret = self.secret.to_dict()

        connector_binding: dict[str, Any] | Unset = UNSET
        if not isinstance(self.connector_binding, Unset):
            connector_binding = self.connector_binding.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
            "type": type_,
            "secret": secret,
        })
        if connector_binding is not UNSET:
            field_dict["connectorBinding"] = connector_binding
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_vault_credential_request_connector_binding import CreateVaultCredentialRequestConnectorBinding
        from ..models.create_vault_credential_request_metadata import CreateVaultCredentialRequestMetadata
        from ..models.create_vault_credential_request_secret import CreateVaultCredentialRequestSecret
        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        secret = CreateVaultCredentialRequestSecret.from_dict(d.pop("secret"))




        _connector_binding = d.pop("connectorBinding", UNSET)
        connector_binding: CreateVaultCredentialRequestConnectorBinding | Unset
        if isinstance(_connector_binding,  Unset):
            connector_binding = UNSET
        else:
            connector_binding = CreateVaultCredentialRequestConnectorBinding.from_dict(_connector_binding)




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateVaultCredentialRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateVaultCredentialRequestMetadata.from_dict(_metadata)




        create_vault_credential_request = cls(
            name=name,
            type_=type_,
            secret=secret,
            connector_binding=connector_binding,
            metadata=metadata,
        )


        create_vault_credential_request.additional_properties = d
        return create_vault_credential_request

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
