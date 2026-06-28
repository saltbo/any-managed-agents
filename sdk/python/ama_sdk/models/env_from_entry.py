from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.env_from_entry_type import EnvFromEntryType






T = TypeVar("T", bound="EnvFromEntry")



@_attrs_define
class EnvFromEntry:
    """ 
        Attributes:
            type_ (EnvFromEntryType):  Example: secret.
            name (str):  Example: GITHUB_TOKEN.
            secret_ref (str):  Example: ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123.
     """

    type_: EnvFromEntryType
    name: str
    secret_ref: str





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        name = self.name

        secret_ref = self.secret_ref


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "name": name,
            "secretRef": secret_ref,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = EnvFromEntryType(d.pop("type"))




        name = d.pop("name")

        secret_ref = d.pop("secretRef")

        env_from_entry = cls(
            type_=type_,
            name=name,
            secret_ref=secret_ref,
        )

        return env_from_entry

