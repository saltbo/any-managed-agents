from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_credential_version_type_0_provider import VaultCredentialVersionType0Provider
from ..models.vault_credential_version_type_0_state import VaultCredentialVersionType0State
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.vault_json_object import VaultJsonObject





T = TypeVar("T", bound="VaultCredentialVersionType0")



@_attrs_define
class VaultCredentialVersionType0:
    """ 
        Attributes:
            id (str):  Example: vaultver_abc123.
            credential_id (str):  Example: vaultcred_abc123.
            vault_id (str):  Example: vault_abc123.
            project_id (None | str):  Example: project_abc123.
            version (int):  Example: 2.
            provider (VaultCredentialVersionType0Provider):  Example: cloudflare-secrets.
            secret_ref (str):  Example: cloudflare-secret:AMA_PROJECT_ABC123_TOKEN_V2.
            external_vault_path (None | str):  Example: vault://team/provider/token.
            reference_name (str):  Example: AMA_PROJECT_ABC123_TOKEN_V2.
            state (VaultCredentialVersionType0State):  Example: active.
            has_secret (bool):  Example: True.
            metadata (VaultJsonObject):  Example: {'rotatedBy': 'operator'}.
            created_at (datetime.datetime):  Example: 2026-05-24T00:00:00.000Z.
            superseded_at (datetime.datetime | None):  Example: 2026-05-24T01:00:00.000Z.
            revoked_at (datetime.datetime | None):
     """

    id: str
    credential_id: str
    vault_id: str
    project_id: None | str
    version: int
    provider: VaultCredentialVersionType0Provider
    secret_ref: str
    external_vault_path: None | str
    reference_name: str
    state: VaultCredentialVersionType0State
    has_secret: bool
    metadata: VaultJsonObject
    created_at: datetime.datetime
    superseded_at: datetime.datetime | None
    revoked_at: datetime.datetime | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.vault_json_object import VaultJsonObject
        id = self.id

        credential_id = self.credential_id

        vault_id = self.vault_id

        project_id: None | str
        project_id = self.project_id

        version = self.version

        provider = self.provider.value

        secret_ref = self.secret_ref

        external_vault_path: None | str
        external_vault_path = self.external_vault_path

        reference_name = self.reference_name

        state = self.state.value

        has_secret = self.has_secret

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()

        superseded_at: None | str
        if isinstance(self.superseded_at, datetime.datetime):
            superseded_at = self.superseded_at.isoformat()
        else:
            superseded_at = self.superseded_at

        revoked_at: None | str
        if isinstance(self.revoked_at, datetime.datetime):
            revoked_at = self.revoked_at.isoformat()
        else:
            revoked_at = self.revoked_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "credentialId": credential_id,
            "vaultId": vault_id,
            "projectId": project_id,
            "version": version,
            "provider": provider,
            "secretRef": secret_ref,
            "externalVaultPath": external_vault_path,
            "referenceName": reference_name,
            "state": state,
            "hasSecret": has_secret,
            "metadata": metadata,
            "createdAt": created_at,
            "supersededAt": superseded_at,
            "revokedAt": revoked_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.vault_json_object import VaultJsonObject
        d = dict(src_dict)
        id = d.pop("id")

        credential_id = d.pop("credentialId")

        vault_id = d.pop("vaultId")

        def _parse_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        project_id = _parse_project_id(d.pop("projectId"))


        version = d.pop("version")

        provider = VaultCredentialVersionType0Provider(d.pop("provider"))




        secret_ref = d.pop("secretRef")

        def _parse_external_vault_path(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_vault_path = _parse_external_vault_path(d.pop("externalVaultPath"))


        reference_name = d.pop("referenceName")

        state = VaultCredentialVersionType0State(d.pop("state"))




        has_secret = d.pop("hasSecret")

        metadata = VaultJsonObject.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        def _parse_superseded_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                superseded_at_type_0 = datetime.datetime.fromisoformat(data)



                return superseded_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        superseded_at = _parse_superseded_at(d.pop("supersededAt"))


        def _parse_revoked_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                revoked_at_type_0 = datetime.datetime.fromisoformat(data)



                return revoked_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        revoked_at = _parse_revoked_at(d.pop("revokedAt"))


        vault_credential_version_type_0 = cls(
            id=id,
            credential_id=credential_id,
            vault_id=vault_id,
            project_id=project_id,
            version=version,
            provider=provider,
            secret_ref=secret_ref,
            external_vault_path=external_vault_path,
            reference_name=reference_name,
            state=state,
            has_secret=has_secret,
            metadata=metadata,
            created_at=created_at,
            superseded_at=superseded_at,
            revoked_at=revoked_at,
        )


        vault_credential_version_type_0.additional_properties = d
        return vault_credential_version_type_0

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
