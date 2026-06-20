from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.credential_ref import CredentialRef





T = TypeVar("T", bound="SecretEnvEntry")



@_attrs_define
class SecretEnvEntry:
    """ 
        Attributes:
            name (str):  Example: GITHUB_TOKEN.
            credential_ref (CredentialRef):
     """

    name: str
    credential_ref: CredentialRef
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.credential_ref import CredentialRef
        name = self.name

        credential_ref = self.credential_ref.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
            "credentialRef": credential_ref,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.credential_ref import CredentialRef
        d = dict(src_dict)
        name = d.pop("name")

        credential_ref = CredentialRef.from_dict(d.pop("credentialRef"))




        secret_env_entry = cls(
            name=name,
            credential_ref=credential_ref,
        )


        secret_env_entry.additional_properties = d
        return secret_env_entry

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
