from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.git_hub_repository_volume_type import GitHubRepositoryVolumeType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.credential_ref import CredentialRef





T = TypeVar("T", bound="GitHubRepositoryVolume")



@_attrs_define
class GitHubRepositoryVolume:
    """ 
        Attributes:
            name (str):  Example: source.
            type_ (GitHubRepositoryVolumeType):
            owner (str):
            repo (str):
            ref (str | Unset):
            credential_ref (CredentialRef | Unset):
     """

    name: str
    type_: GitHubRepositoryVolumeType
    owner: str
    repo: str
    ref: str | Unset = UNSET
    credential_ref: CredentialRef | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.credential_ref import CredentialRef
        name = self.name

        type_ = self.type_.value

        owner = self.owner

        repo = self.repo

        ref = self.ref

        credential_ref: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credential_ref, Unset):
            credential_ref = self.credential_ref.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
            "owner": owner,
            "repo": repo,
        })
        if ref is not UNSET:
            field_dict["ref"] = ref
        if credential_ref is not UNSET:
            field_dict["credentialRef"] = credential_ref

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.credential_ref import CredentialRef
        d = dict(src_dict)
        name = d.pop("name")

        type_ = GitHubRepositoryVolumeType(d.pop("type"))




        owner = d.pop("owner")

        repo = d.pop("repo")

        ref = d.pop("ref", UNSET)

        _credential_ref = d.pop("credentialRef", UNSET)
        credential_ref: CredentialRef | Unset
        if isinstance(_credential_ref,  Unset):
            credential_ref = UNSET
        else:
            credential_ref = CredentialRef.from_dict(_credential_ref)




        git_hub_repository_volume = cls(
            name=name,
            type_=type_,
            owner=owner,
            repo=repo,
            ref=ref,
            credential_ref=credential_ref,
        )

        return git_hub_repository_volume

