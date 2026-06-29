from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_credential_version_request_metadata import CreateVaultCredentialVersionRequestMetadata
  from ..models.create_vault_credential_version_request_string_data import CreateVaultCredentialVersionRequestStringData





T = TypeVar("T", bound="CreateVaultCredentialVersionRequest")



@_attrs_define
class CreateVaultCredentialVersionRequest:
    """ 
        Attributes:
            string_data (CreateVaultCredentialVersionRequestStringData):  Example: {'token': 'redacted-input-only'}.
            reference_name (str | Unset):  Example: AMA_PROJECT_TOKEN.
            metadata (CreateVaultCredentialVersionRequestMetadata | Unset):  Example: {'source': 'console'}.
     """

    string_data: CreateVaultCredentialVersionRequestStringData
    reference_name: str | Unset = UNSET
    metadata: CreateVaultCredentialVersionRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_credential_version_request_metadata import CreateVaultCredentialVersionRequestMetadata
        from ..models.create_vault_credential_version_request_string_data import CreateVaultCredentialVersionRequestStringData
        string_data = self.string_data.to_dict()

        reference_name = self.reference_name

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "stringData": string_data,
        })
        if reference_name is not UNSET:
            field_dict["referenceName"] = reference_name
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_vault_credential_version_request_metadata import CreateVaultCredentialVersionRequestMetadata
        from ..models.create_vault_credential_version_request_string_data import CreateVaultCredentialVersionRequestStringData
        d = dict(src_dict)
        string_data = CreateVaultCredentialVersionRequestStringData.from_dict(d.pop("stringData"))




        reference_name = d.pop("referenceName", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateVaultCredentialVersionRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateVaultCredentialVersionRequestMetadata.from_dict(_metadata)




        create_vault_credential_version_request = cls(
            string_data=string_data,
            reference_name=reference_name,
            metadata=metadata,
        )

        return create_vault_credential_version_request

