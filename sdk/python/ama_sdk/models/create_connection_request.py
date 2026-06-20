from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_connection_request_approval_mode import CreateConnectionRequestApprovalMode
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_connection_request_metadata import CreateConnectionRequestMetadata
  from ..models.credential_ref import CredentialRef





T = TypeVar("T", bound="CreateConnectionRequest")



@_attrs_define
class CreateConnectionRequest:
    """ 
        Attributes:
            connector_id (str):
            endpoint_url (str | Unset):
            credential_ref (CredentialRef | Unset):
            approval_mode (CreateConnectionRequestApprovalMode | Unset):
            metadata (CreateConnectionRequestMetadata | Unset):
     """

    connector_id: str
    endpoint_url: str | Unset = UNSET
    credential_ref: CredentialRef | Unset = UNSET
    approval_mode: CreateConnectionRequestApprovalMode | Unset = UNSET
    metadata: CreateConnectionRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_connection_request_metadata import CreateConnectionRequestMetadata
        from ..models.credential_ref import CredentialRef
        connector_id = self.connector_id

        endpoint_url = self.endpoint_url

        credential_ref: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credential_ref, Unset):
            credential_ref = self.credential_ref.to_dict()

        approval_mode: str | Unset = UNSET
        if not isinstance(self.approval_mode, Unset):
            approval_mode = self.approval_mode.value


        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "connectorId": connector_id,
        })
        if endpoint_url is not UNSET:
            field_dict["endpointUrl"] = endpoint_url
        if credential_ref is not UNSET:
            field_dict["credentialRef"] = credential_ref
        if approval_mode is not UNSET:
            field_dict["approvalMode"] = approval_mode
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_connection_request_metadata import CreateConnectionRequestMetadata
        from ..models.credential_ref import CredentialRef
        d = dict(src_dict)
        connector_id = d.pop("connectorId")

        endpoint_url = d.pop("endpointUrl", UNSET)

        _credential_ref = d.pop("credentialRef", UNSET)
        credential_ref: CredentialRef | Unset
        if isinstance(_credential_ref,  Unset):
            credential_ref = UNSET
        else:
            credential_ref = CredentialRef.from_dict(_credential_ref)




        _approval_mode = d.pop("approvalMode", UNSET)
        approval_mode: CreateConnectionRequestApprovalMode | Unset
        if isinstance(_approval_mode,  Unset):
            approval_mode = UNSET
        else:
            approval_mode = CreateConnectionRequestApprovalMode(_approval_mode)




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateConnectionRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateConnectionRequestMetadata.from_dict(_metadata)




        create_connection_request = cls(
            connector_id=connector_id,
            endpoint_url=endpoint_url,
            credential_ref=credential_ref,
            approval_mode=approval_mode,
            metadata=metadata,
        )

        return create_connection_request

