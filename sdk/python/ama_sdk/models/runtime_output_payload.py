from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime_output_payload_stream import RuntimeOutputPayloadStream
from ..types import UNSET, Unset






T = TypeVar("T", bound="RuntimeOutputPayload")



@_attrs_define
class RuntimeOutputPayload:
    """ 
        Attributes:
            stream (RuntimeOutputPayloadStream):
            content (Any | Unset):
     """

    stream: RuntimeOutputPayloadStream
    content: Any | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        stream = self.stream.value

        content = self.content


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "stream": stream,
        })
        if content is not UNSET:
            field_dict["content"] = content

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        stream = RuntimeOutputPayloadStream(d.pop("stream"))




        content = d.pop("content", UNSET)

        runtime_output_payload = cls(
            stream=stream,
            content=content,
        )

        return runtime_output_payload

