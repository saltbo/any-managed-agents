from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.replace_agent_memory_request_metadata import ReplaceAgentMemoryRequestMetadata





T = TypeVar("T", bound="ReplaceAgentMemoryRequest")



@_attrs_define
class ReplaceAgentMemoryRequest:
    """ 
        Attributes:
            content (str):  Example: Checked stale tasks. Follow up on repo resource migration next heartbeat..
            metadata (ReplaceAgentMemoryRequestMetadata | Unset):  Example: {'format': 'markdown'}.
     """

    content: str
    metadata: ReplaceAgentMemoryRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.replace_agent_memory_request_metadata import ReplaceAgentMemoryRequestMetadata
        content = self.content

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "content": content,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.replace_agent_memory_request_metadata import ReplaceAgentMemoryRequestMetadata
        d = dict(src_dict)
        content = d.pop("content")

        _metadata = d.pop("metadata", UNSET)
        metadata: ReplaceAgentMemoryRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = ReplaceAgentMemoryRequestMetadata.from_dict(_metadata)




        replace_agent_memory_request = cls(
            content=content,
            metadata=metadata,
        )

        return replace_agent_memory_request

