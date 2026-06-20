from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_vault_request_scope import CreateVaultRequestScope
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_vault_request_metadata import CreateVaultRequestMetadata





T = TypeVar("T", bound="CreateVaultRequest")



@_attrs_define
class CreateVaultRequest:
    """ 
        Attributes:
            name (str):  Example: Provider credentials.
            description (str | Unset):  Example: Credentials used by runtime sessions..
            scope (CreateVaultRequestScope | Unset):  Example: project.
            metadata (CreateVaultRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    name: str
    description: str | Unset = UNSET
    scope: CreateVaultRequestScope | Unset = UNSET
    metadata: CreateVaultRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_vault_request_metadata import CreateVaultRequestMetadata
        name = self.name

        description = self.description

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value


        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "name": name,
        })
        if description is not UNSET:
            field_dict["description"] = description
        if scope is not UNSET:
            field_dict["scope"] = scope
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_vault_request_metadata import CreateVaultRequestMetadata
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: CreateVaultRequestScope | Unset
        if isinstance(_scope,  Unset):
            scope = UNSET
        else:
            scope = CreateVaultRequestScope(_scope)




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateVaultRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateVaultRequestMetadata.from_dict(_metadata)




        create_vault_request = cls(
            name=name,
            description=description,
            scope=scope,
            metadata=metadata,
        )


        create_vault_request.additional_properties = d
        return create_vault_request

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
