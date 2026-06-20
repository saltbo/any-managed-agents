from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_connection_request_approval_mode import UpdateConnectionRequestApprovalMode
from ..models.update_connection_request_state import UpdateConnectionRequestState
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_connection_request_credential_ref import UpdateConnectionRequestCredentialRef
  from ..models.update_connection_request_metadata import UpdateConnectionRequestMetadata





T = TypeVar("T", bound="UpdateConnectionRequest")



@_attrs_define
class UpdateConnectionRequest:
    """ 
        Attributes:
            endpoint_url (None | str | Unset):
            credential_ref (UpdateConnectionRequestCredentialRef | Unset):
            approval_mode (UpdateConnectionRequestApprovalMode | Unset):
            state (UpdateConnectionRequestState | Unset):
            metadata (UpdateConnectionRequestMetadata | Unset):
     """

    endpoint_url: None | str | Unset = UNSET
    credential_ref: UpdateConnectionRequestCredentialRef | Unset = UNSET
    approval_mode: UpdateConnectionRequestApprovalMode | Unset = UNSET
    state: UpdateConnectionRequestState | Unset = UNSET
    metadata: UpdateConnectionRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_connection_request_credential_ref import UpdateConnectionRequestCredentialRef
        from ..models.update_connection_request_metadata import UpdateConnectionRequestMetadata
        endpoint_url: None | str | Unset
        if isinstance(self.endpoint_url, Unset):
            endpoint_url = UNSET
        else:
            endpoint_url = self.endpoint_url

        credential_ref: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credential_ref, Unset):
            credential_ref = self.credential_ref.to_dict()

        approval_mode: str | Unset = UNSET
        if not isinstance(self.approval_mode, Unset):
            approval_mode = self.approval_mode.value


        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value


        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if endpoint_url is not UNSET:
            field_dict["endpointUrl"] = endpoint_url
        if credential_ref is not UNSET:
            field_dict["credentialRef"] = credential_ref
        if approval_mode is not UNSET:
            field_dict["approvalMode"] = approval_mode
        if state is not UNSET:
            field_dict["state"] = state
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_connection_request_credential_ref import UpdateConnectionRequestCredentialRef
        from ..models.update_connection_request_metadata import UpdateConnectionRequestMetadata
        d = dict(src_dict)
        def _parse_endpoint_url(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        endpoint_url = _parse_endpoint_url(d.pop("endpointUrl", UNSET))


        _credential_ref = d.pop("credentialRef", UNSET)
        credential_ref: UpdateConnectionRequestCredentialRef | Unset
        if isinstance(_credential_ref,  Unset):
            credential_ref = UNSET
        else:
            credential_ref = UpdateConnectionRequestCredentialRef.from_dict(_credential_ref)




        _approval_mode = d.pop("approvalMode", UNSET)
        approval_mode: UpdateConnectionRequestApprovalMode | Unset
        if isinstance(_approval_mode,  Unset):
            approval_mode = UNSET
        else:
            approval_mode = UpdateConnectionRequestApprovalMode(_approval_mode)




        _state = d.pop("state", UNSET)
        state: UpdateConnectionRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = UpdateConnectionRequestState(_state)




        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateConnectionRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateConnectionRequestMetadata.from_dict(_metadata)




        update_connection_request = cls(
            endpoint_url=endpoint_url,
            credential_ref=credential_ref,
            approval_mode=approval_mode,
            state=state,
            metadata=metadata,
        )

        return update_connection_request

