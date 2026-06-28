from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.runner_resolved_volume_file import RunnerResolvedVolumeFile





T = TypeVar("T", bound="RunnerResolvedVolumeMount")



@_attrs_define
class RunnerResolvedVolumeMount:
    """ 
        Attributes:
            name (str):  Example: github-token.
            mount_path (str):  Example: /workspace/.ama/secrets/github-token.
            read_only (bool):  Example: True.
            files (list[RunnerResolvedVolumeFile]):
     """

    name: str
    mount_path: str
    read_only: bool
    files: list[RunnerResolvedVolumeFile]





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_resolved_volume_file import RunnerResolvedVolumeFile
        name = self.name

        mount_path = self.mount_path

        read_only = self.read_only

        files = []
        for files_item_data in self.files:
            files_item = files_item_data.to_dict()
            files.append(files_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "mountPath": mount_path,
            "readOnly": read_only,
            "files": files,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_resolved_volume_file import RunnerResolvedVolumeFile
        d = dict(src_dict)
        name = d.pop("name")

        mount_path = d.pop("mountPath")

        read_only = d.pop("readOnly")

        files = []
        _files = d.pop("files")
        for files_item_data in (_files):
            files_item = RunnerResolvedVolumeFile.from_dict(files_item_data)



            files.append(files_item)


        runner_resolved_volume_mount = cls(
            name=name,
            mount_path=mount_path,
            read_only=read_only,
            files=files,
        )

        return runner_resolved_volume_mount

