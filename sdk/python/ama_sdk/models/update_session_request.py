from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_session_request_state import UpdateSessionRequestState
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_session_request_metadata import UpdateSessionRequestMetadata





T = TypeVar("T", bound="UpdateSessionRequest")



@_attrs_define
class UpdateSessionRequest:
    """ 
        Attributes:
            title (None | str | Unset):  Example: Implement billing export.
            metadata (UpdateSessionRequestMetadata | Unset):  Example: {'ticket': 'AMA-123'}.
            state (UpdateSessionRequestState | Unset):  Example: stopped.
            archived (bool | Unset):  Example: True.
     """

    title: None | str | Unset = UNSET
    metadata: UpdateSessionRequestMetadata | Unset = UNSET
    state: UpdateSessionRequestState | Unset = UNSET
    archived: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_session_request_metadata import UpdateSessionRequestMetadata
        title: None | str | Unset
        if isinstance(self.title, Unset):
            title = UNSET
        else:
            title = self.title

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value


        archived = self.archived


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if title is not UNSET:
            field_dict["title"] = title
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if state is not UNSET:
            field_dict["state"] = state
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_session_request_metadata import UpdateSessionRequestMetadata
        d = dict(src_dict)
        def _parse_title(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        title = _parse_title(d.pop("title", UNSET))


        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateSessionRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateSessionRequestMetadata.from_dict(_metadata)




        _state = d.pop("state", UNSET)
        state: UpdateSessionRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = UpdateSessionRequestState(_state)




        archived = d.pop("archived", UNSET)

        update_session_request = cls(
            title=title,
            metadata=metadata,
            state=state,
            archived=archived,
        )

        return update_session_request

