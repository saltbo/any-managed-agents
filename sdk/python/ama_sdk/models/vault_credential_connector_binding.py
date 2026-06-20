from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="VaultCredentialConnectorBinding")



@_attrs_define
class VaultCredentialConnectorBinding:
    """ 
        Example:
            {'connectorId': 'workers-ai', 'name': 'apiKey'}

        Attributes:
            connector_id (str | Unset):
            name (str | Unset):
     """

    connector_id: str | Unset = UNSET
    name: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        connector_id = self.connector_id

        name = self.name


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if connector_id is not UNSET:
            field_dict["connectorId"] = connector_id
        if name is not UNSET:
            field_dict["name"] = name

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        connector_id = d.pop("connectorId", UNSET)

        name = d.pop("name", UNSET)

        vault_credential_connector_binding = cls(
            connector_id=connector_id,
            name=name,
        )

        return vault_credential_connector_binding

