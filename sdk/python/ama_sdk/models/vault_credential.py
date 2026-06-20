from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.vault_credential_state import VaultCredentialState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.vault_credential_connector_binding import VaultCredentialConnectorBinding
  from ..models.vault_credential_metadata import VaultCredentialMetadata
  from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0





T = TypeVar("T", bound="VaultCredential")



@_attrs_define
class VaultCredential:
    """ 
        Attributes:
            id (str):  Example: vaultcred_abc123.
            vault_id (str):  Example: vault_abc123.
            project_id (None | str):  Example: project_abc123.
            name (str):  Example: Workers AI token.
            type_ (str):  Example: api_key.
            connector_binding (VaultCredentialConnectorBinding):  Example: {'connectorId': 'workers-ai', 'name': 'apiKey'}.
            metadata (VaultCredentialMetadata):  Example: {'owner': 'platform'}.
            state (VaultCredentialState):  Example: active.
            active_version_id (None | str):  Example: vaultver_abc123.
            active_version (None | VaultCredentialVersionType0):
            revoked_at (datetime.datetime | None):
            revoked_by_user_id (None | str):
            revoke_reason (None | str):
            created_at (datetime.datetime):  Example: 2026-05-24T00:00:00.000Z.
            updated_at (datetime.datetime):  Example: 2026-05-24T00:00:00.000Z.
     """

    id: str
    vault_id: str
    project_id: None | str
    name: str
    type_: str
    connector_binding: VaultCredentialConnectorBinding
    metadata: VaultCredentialMetadata
    state: VaultCredentialState
    active_version_id: None | str
    active_version: None | VaultCredentialVersionType0
    revoked_at: datetime.datetime | None
    revoked_by_user_id: None | str
    revoke_reason: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.vault_credential_connector_binding import VaultCredentialConnectorBinding
        from ..models.vault_credential_metadata import VaultCredentialMetadata
        from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0
        id = self.id

        vault_id = self.vault_id

        project_id: None | str
        project_id = self.project_id

        name = self.name

        type_ = self.type_

        connector_binding = self.connector_binding.to_dict()

        metadata = self.metadata.to_dict()

        state = self.state.value

        active_version_id: None | str
        active_version_id = self.active_version_id

        active_version: dict[str, Any] | None
        if isinstance(self.active_version, VaultCredentialVersionType0):
            active_version = self.active_version.to_dict()
        else:
            active_version = self.active_version

        revoked_at: None | str
        if isinstance(self.revoked_at, datetime.datetime):
            revoked_at = self.revoked_at.isoformat()
        else:
            revoked_at = self.revoked_at

        revoked_by_user_id: None | str
        revoked_by_user_id = self.revoked_by_user_id

        revoke_reason: None | str
        revoke_reason = self.revoke_reason

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "vaultId": vault_id,
            "projectId": project_id,
            "name": name,
            "type": type_,
            "connectorBinding": connector_binding,
            "metadata": metadata,
            "state": state,
            "activeVersionId": active_version_id,
            "activeVersion": active_version,
            "revokedAt": revoked_at,
            "revokedByUserId": revoked_by_user_id,
            "revokeReason": revoke_reason,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.vault_credential_connector_binding import VaultCredentialConnectorBinding
        from ..models.vault_credential_metadata import VaultCredentialMetadata
        from ..models.vault_credential_version_type_0 import VaultCredentialVersionType0
        d = dict(src_dict)
        id = d.pop("id")

        vault_id = d.pop("vaultId")

        def _parse_project_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        project_id = _parse_project_id(d.pop("projectId"))


        name = d.pop("name")

        type_ = d.pop("type")

        connector_binding = VaultCredentialConnectorBinding.from_dict(d.pop("connectorBinding"))




        metadata = VaultCredentialMetadata.from_dict(d.pop("metadata"))




        state = VaultCredentialState(d.pop("state"))




        def _parse_active_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        active_version_id = _parse_active_version_id(d.pop("activeVersionId"))


        def _parse_active_version(data: object) -> None | VaultCredentialVersionType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_vault_credential_version_type_0 = VaultCredentialVersionType0.from_dict(data)



                return componentsschemas_vault_credential_version_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | VaultCredentialVersionType0, data)

        active_version = _parse_active_version(d.pop("activeVersion"))


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


        def _parse_revoked_by_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        revoked_by_user_id = _parse_revoked_by_user_id(d.pop("revokedByUserId"))


        def _parse_revoke_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        revoke_reason = _parse_revoke_reason(d.pop("revokeReason"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        vault_credential = cls(
            id=id,
            vault_id=vault_id,
            project_id=project_id,
            name=name,
            type_=type_,
            connector_binding=connector_binding,
            metadata=metadata,
            state=state,
            active_version_id=active_version_id,
            active_version=active_version,
            revoked_at=revoked_at,
            revoked_by_user_id=revoked_by_user_id,
            revoke_reason=revoke_reason,
            created_at=created_at,
            updated_at=updated_at,
        )


        vault_credential.additional_properties = d
        return vault_credential

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
