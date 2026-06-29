from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_trigger_request_template_metadata_annotations import UpdateTriggerRequestTemplateMetadataAnnotations
  from ..models.update_trigger_request_template_metadata_labels import UpdateTriggerRequestTemplateMetadataLabels





T = TypeVar("T", bound="UpdateTriggerRequestTemplateMetadata")



@_attrs_define
class UpdateTriggerRequestTemplateMetadata:
    """ 
        Attributes:
            labels (UpdateTriggerRequestTemplateMetadataLabels | Unset):  Example: {'app': 'agent-kanban'}.
            annotations (UpdateTriggerRequestTemplateMetadataAnnotations | Unset):  Example: {'owner': 'growth'}.
     """

    labels: UpdateTriggerRequestTemplateMetadataLabels | Unset = UNSET
    annotations: UpdateTriggerRequestTemplateMetadataAnnotations | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_trigger_request_template_metadata_annotations import UpdateTriggerRequestTemplateMetadataAnnotations
        from ..models.update_trigger_request_template_metadata_labels import UpdateTriggerRequestTemplateMetadataLabels
        labels: dict[str, Any] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels.to_dict()

        annotations: dict[str, Any] | Unset = UNSET
        if not isinstance(self.annotations, Unset):
            annotations = self.annotations.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if labels is not UNSET:
            field_dict["labels"] = labels
        if annotations is not UNSET:
            field_dict["annotations"] = annotations

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_trigger_request_template_metadata_annotations import UpdateTriggerRequestTemplateMetadataAnnotations
        from ..models.update_trigger_request_template_metadata_labels import UpdateTriggerRequestTemplateMetadataLabels
        d = dict(src_dict)
        _labels = d.pop("labels", UNSET)
        labels: UpdateTriggerRequestTemplateMetadataLabels | Unset
        if isinstance(_labels,  Unset):
            labels = UNSET
        else:
            labels = UpdateTriggerRequestTemplateMetadataLabels.from_dict(_labels)




        _annotations = d.pop("annotations", UNSET)
        annotations: UpdateTriggerRequestTemplateMetadataAnnotations | Unset
        if isinstance(_annotations,  Unset):
            annotations = UNSET
        else:
            annotations = UpdateTriggerRequestTemplateMetadataAnnotations.from_dict(_annotations)




        update_trigger_request_template_metadata = cls(
            labels=labels,
            annotations=annotations,
        )


        update_trigger_request_template_metadata.additional_properties = d
        return update_trigger_request_template_metadata

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
