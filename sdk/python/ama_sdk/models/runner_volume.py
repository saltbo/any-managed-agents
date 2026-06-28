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
            type_ (RunnerVolumeType):  Example: github_repository.
            secret_ref (str | Unset):
            owner (str | Unset):  Example: saltbo.
            repo (str | Unset):  Example: any-managed-agents.
            ref (str | Unset):  Example: main.
            store_id (str | Unset):  Example: memstore_abc123.
            description (None | str | Unset):
            access (str | Unset):  Example: read_write.
            memories (list[RunnerMemorySnapshot] | Unset):
     """

    name: str
    type_: RunnerVolumeType
    secret_ref: str | Unset = UNSET
    owner: str | Unset = UNSET
    repo: str | Unset = UNSET
    ref: str | Unset = UNSET
    store_id: str | Unset = UNSET
    description: None | str | Unset = UNSET
    access: str | Unset = UNSET
    memories: list[RunnerMemorySnapshot] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_memory_snapshot import RunnerMemorySnapshot
        name = self.name

        type_ = self.type_.value

        secret_ref = self.secret_ref

        owner = self.owner

        repo = self.repo

        ref = self.ref

        store_id = self.store_id

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
        if owner is not UNSET:
            field_dict["owner"] = owner
        if repo is not UNSET:
            field_dict["repo"] = repo
        if ref is not UNSET:
            field_dict["ref"] = ref
        if store_id is not UNSET:
            field_dict["storeId"] = store_id
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

        owner = d.pop("owner", UNSET)

        repo = d.pop("repo", UNSET)

        ref = d.pop("ref", UNSET)

        store_id = d.pop("storeId", UNSET)

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
            owner=owner,
            repo=repo,
            ref=ref,
            store_id=store_id,
            description=description,
            access=access,
            memories=memories,
        )

        return runner_volume

