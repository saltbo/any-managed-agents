from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.session_metadata_annotations import SessionMetadataAnnotations
  from ..models.session_metadata_labels import SessionMetadataLabels





T = TypeVar("T", bound="SessionMetadata")



@_attrs_define
class SessionMetadata:
    """ 
        Attributes:
            uid (str):  Example: session_abc123.
            pid (str):  Example: project_abc123.
            name (str):  Example: Implement billing export.
            labels (SessionMetadataLabels):
            annotations (SessionMetadataAnnotations):
            created_by (None | str):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
            archived_at (datetime.datetime | None):
     """

    uid: str
    pid: str
    name: str
    labels: SessionMetadataLabels
    annotations: SessionMetadataAnnotations
    created_by: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    archived_at: datetime.datetime | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_metadata_annotations import SessionMetadataAnnotations
        from ..models.session_metadata_labels import SessionMetadataLabels
        uid = self.uid

        pid = self.pid

        name = self.name

        labels = self.labels.to_dict()

        annotations = self.annotations.to_dict()

        created_by: None | str
        created_by = self.created_by

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "uid": uid,
            "pid": pid,
            "name": name,
            "labels": labels,
            "annotations": annotations,
            "createdBy": created_by,
            "createdAt": created_at,
            "updatedAt": updated_at,
            "archivedAt": archived_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_metadata_annotations import SessionMetadataAnnotations
        from ..models.session_metadata_labels import SessionMetadataLabels
        d = dict(src_dict)
        uid = d.pop("uid")

        pid = d.pop("pid")

        name = d.pop("name")

        labels = SessionMetadataLabels.from_dict(d.pop("labels"))




        annotations = SessionMetadataAnnotations.from_dict(d.pop("annotations"))




        def _parse_created_by(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by = _parse_created_by(d.pop("createdBy"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        def _parse_archived_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                archived_at_type_0 = datetime.datetime.fromisoformat(data)



                return archived_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))


        session_metadata = cls(
            uid=uid,
            pid=pid,
            name=name,
            labels=labels,
            annotations=annotations,
            created_by=created_by,
            created_at=created_at,
            updated_at=updated_at,
            archived_at=archived_at,
        )


        session_metadata.additional_properties = d
        return session_metadata

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
