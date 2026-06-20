from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_vault_request_scope import UpdateVaultRequestScope
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_vault_request_metadata import UpdateVaultRequestMetadata





T = TypeVar("T", bound="UpdateVaultRequest")



@_attrs_define
class UpdateVaultRequest:
    """ 
        Attributes:
            name (str | Unset):  Example: Provider credentials.
            description (str | Unset):  Example: Credentials used by runtime sessions..
            scope (UpdateVaultRequestScope | Unset):  Example: project.
            metadata (UpdateVaultRequestMetadata | Unset):  Example: {'owner': 'platform'}.
            archived (bool | Unset):  Example: True.
     """

    name: str | Unset = UNSET
    description: str | Unset = UNSET
    scope: UpdateVaultRequestScope | Unset = UNSET
    metadata: UpdateVaultRequestMetadata | Unset = UNSET
    archived: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_vault_request_metadata import UpdateVaultRequestMetadata
        name = self.name

        description = self.description

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value


        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        archived = self.archived


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if scope is not UNSET:
            field_dict["scope"] = scope
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_vault_request_metadata import UpdateVaultRequestMetadata
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: UpdateVaultRequestScope | Unset
        if isinstance(_scope,  Unset):
            scope = UNSET
        else:
            scope = UpdateVaultRequestScope(_scope)




        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateVaultRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateVaultRequestMetadata.from_dict(_metadata)




        archived = d.pop("archived", UNSET)

        update_vault_request = cls(
            name=name,
            description=description,
            scope=scope,
            metadata=metadata,
            archived=archived,
        )


        update_vault_request.additional_properties = d
        return update_vault_request

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
