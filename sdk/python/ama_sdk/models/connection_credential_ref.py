from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="ConnectionCredentialRef")



@_attrs_define
class ConnectionCredentialRef:
    """ 
        Attributes:
            credential_id (str):  Example: vaultcred_abc123.
            version_id (str | Unset):  Example: vaultver_abc123.
     """

    credential_id: str
    version_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        credential_id = self.credential_id

        version_id = self.version_id


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "credentialId": credential_id,
        })
        if version_id is not UNSET:
            field_dict["versionId"] = version_id

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        credential_id = d.pop("credentialId")

        version_id = d.pop("versionId", UNSET)

        connection_credential_ref = cls(
            credential_id=credential_id,
            version_id=version_id,
        )


        connection_credential_ref.additional_properties = d
        return connection_credential_ref

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
