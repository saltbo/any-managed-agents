from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_volume_type import RunnerVolumeType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_memory_snapshot import RunnerMemorySnapshot





T = TypeVar("T", bound="RunnerVolume")



@_attrs_define
class RunnerVolume:
    """ 
        Attributes:
            name (str):  Example: source.
            type_ (RunnerVolumeType):  Example: git_repository.
            secret_ref (str | Unset):
            url (str | Unset):  Example: https://github.com/saltbo/any-managed-agents.git.
            ref (str | Unset):  Example: main.
            memory_ref (str | Unset):  Example: ama://memories/memstore_abc123.
            description (None | str | Unset):
            access (str | Unset):  Example: read_write.
            memories (list[RunnerMemorySnapshot] | Unset):
     """

    name: str
    type_: RunnerVolumeType
    secret_ref: str | Unset = UNSET
    url: str | Unset = UNSET
    ref: str | Unset = UNSET
    memory_ref: str | Unset = UNSET
    description: None | str | Unset = UNSET
    access: str | Unset = UNSET
    memories: list[RunnerMemorySnapshot] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_memory_snapshot import RunnerMemorySnapshot
        name = self.name

        type_ = self.type_.value

        secret_ref = self.secret_ref

        url = self.url

        ref = self.ref

        memory_ref = self.memory_ref

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        access = self.access

        memories: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.memories, Unset):
            memories = []
            for memories_item_data in self.memories:
                memories_item = memories_item_data.to_dict()
                memories.append(memories_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
        })
        if secret_ref is not UNSET:
            field_dict["secretRef"] = secret_ref
        if url is not UNSET:
            field_dict["url"] = url
        if ref is not UNSET:
            field_dict["ref"] = ref
        if memory_ref is not UNSET:
            field_dict["memoryRef"] = memory_ref
        if description is not UNSET:
            field_dict["description"] = description
        if access is not UNSET:
            field_dict["access"] = access
        if memories is not UNSET:
            field_dict["memories"] = memories

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_memory_snapshot import RunnerMemorySnapshot
        d = dict(src_dict)
        name = d.pop("name")

        type_ = RunnerVolumeType(d.pop("type"))




        secret_ref = d.pop("secretRef", UNSET)

        url = d.pop("url", UNSET)

        ref = d.pop("ref", UNSET)

        memory_ref = d.pop("memoryRef", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        access = d.pop("access", UNSET)

        _memories = d.pop("memories", UNSET)
        memories: list[RunnerMemorySnapshot] | Unset = UNSET
        if _memories is not UNSET:
            memories = []
            for memories_item_data in _memories:
                memories_item = RunnerMemorySnapshot.from_dict(memories_item_data)



                memories.append(memories_item)


        runner_volume = cls(
            name=name,
            type_=type_,
            secret_ref=secret_ref,
            url=url,
            ref=ref,
            memory_ref=memory_ref,
            description=description,
            access=access,
            memories=memories,
        )

        return runner_volume

