from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_memory_snapshot import RunnerMemorySnapshot





T = TypeVar("T", bound="RunnerResourceRef")



@_attrs_define
class RunnerResourceRef:
    """ 
        Attributes:
            type_ (str):  Example: github_repository.
            owner (str | Unset):  Example: saltbo.
            repo (str | Unset):  Example: any-managed-agents.
            ref (str | Unset):  Example: main.
            mount_path (str | Unset):  Example: repo.
            store_id (str | Unset):  Example: memstore_abc123.
            name (str | Unset):  Example: Project memory.
            description (None | str | Unset):
            access (str | Unset):  Example: read_write.
            memories (list[RunnerMemorySnapshot] | Unset):
     """

    type_: str
    owner: str | Unset = UNSET
    repo: str | Unset = UNSET
    ref: str | Unset = UNSET
    mount_path: str | Unset = UNSET
    store_id: str | Unset = UNSET
    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    access: str | Unset = UNSET
    memories: list[RunnerMemorySnapshot] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_memory_snapshot import RunnerMemorySnapshot
        type_ = self.type_

        owner = self.owner

        repo = self.repo

        ref = self.ref

        mount_path = self.mount_path

        store_id = self.store_id

        name = self.name

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
            "type": type_,
        })
        if owner is not UNSET:
            field_dict["owner"] = owner
        if repo is not UNSET:
            field_dict["repo"] = repo
        if ref is not UNSET:
            field_dict["ref"] = ref
        if mount_path is not UNSET:
            field_dict["mountPath"] = mount_path
        if store_id is not UNSET:
            field_dict["storeId"] = store_id
        if name is not UNSET:
            field_dict["name"] = name
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
        type_ = d.pop("type")

        owner = d.pop("owner", UNSET)

        repo = d.pop("repo", UNSET)

        ref = d.pop("ref", UNSET)

        mount_path = d.pop("mountPath", UNSET)

        store_id = d.pop("storeId", UNSET)

        name = d.pop("name", UNSET)

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


        runner_resource_ref = cls(
            type_=type_,
            owner=owner,
            repo=repo,
            ref=ref,
            mount_path=mount_path,
            store_id=store_id,
            name=name,
            description=description,
            access=access,
            memories=memories,
        )

        return runner_resource_ref

