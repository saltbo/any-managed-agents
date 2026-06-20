from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_vault_credential_request_secret_provider import CreateVaultCredentialRequestSecretProvider
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_credential_request_secret_metadata import CreateVaultCredentialRequestSecretMetadata





T = TypeVar("T", bound="CreateVaultCredentialRequestSecret")



@_attrs_define
class CreateVaultCredentialRequestSecret:
    """ 
        Example:
            {'provider': 'cloudflare-secrets', 'secretValue': 'input-only'}

        Attributes:
            provider (CreateVaultCredentialRequestSecretProvider | Unset):  Example: cloudflare-secrets.
            secret_value (str | Unset):  Example: redacted-input-only.
            external_vault_path (str | Unset):  Example: vault://team/provider/token.
            reference_name (str | Unset):  Example: AMA_PROJECT_TOKEN.
            metadata (CreateVaultCredentialRequestSecretMetadata | Unset):  Example: {'source': 'console'}.
     """

    provider: CreateVaultCredentialRequestSecretProvider | Unset = UNSET
    secret_value: str | Unset = UNSET
    external_vault_path: str | Unset = UNSET
    reference_name: str | Unset = UNSET
    metadata: CreateVaultCredentialRequestSecretMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_credential_request_secret_metadata import CreateVaultCredentialRequestSecretMetadata
        provider: str | Unset = UNSET
        if not isinstance(self.provider, Unset):
            provider = self.provider.value


        secret_value = self.secret_value

        external_vault_path = self.external_vault_path

        reference_name = self.reference_name

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if provider is not UNSET:
            field_dict["provider"] = provider
        if secret_value is not UNSET:
            field_dict["secretValue"] = secret_value
        if external_vault_path is not UNSET:
            field_dict["externalVaultPath"] = external_vault_path
        if reference_name is not UNSET:
            field_dict["referenceName"] = reference_name
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_vault_credential_request_secret_metadata import CreateVaultCredentialRequestSecretMetadata
        d = dict(src_dict)
        _provider = d.pop("provider", UNSET)
        provider: CreateVaultCredentialRequestSecretProvider | Unset
        if isinstance(_provider,  Unset):
            provider = UNSET
        else:
            provider = CreateVaultCredentialRequestSecretProvider(_provider)




        secret_value = d.pop("secretValue", UNSET)

        external_vault_path = d.pop("externalVaultPath", UNSET)

        reference_name = d.pop("referenceName", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateVaultCredentialRequestSecretMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateVaultCredentialRequestSecretMetadata.from_dict(_metadata)




        create_vault_credential_request_secret = cls(
            provider=provider,
            secret_value=secret_value,
            external_vault_path=external_vault_path,
            reference_name=reference_name,
            metadata=metadata,
        )

        return create_vault_credential_request_secret

