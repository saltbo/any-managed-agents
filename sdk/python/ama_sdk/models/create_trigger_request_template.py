from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_trigger_request_template_metadata import CreateTriggerRequestTemplateMetadata
  from ..models.create_trigger_request_template_spec import CreateTriggerRequestTemplateSpec





T = TypeVar("T", bound="CreateTriggerRequestTemplate")



@_attrs_define
class CreateTriggerRequestTemplate:
    """ 
        Attributes:
            spec (CreateTriggerRequestTemplateSpec):
            metadata (CreateTriggerRequestTemplateMetadata | Unset):
     """

    spec: CreateTriggerRequestTemplateSpec
    metadata: CreateTriggerRequestTemplateMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_template_metadata import CreateTriggerRequestTemplateMetadata
        from ..models.create_trigger_request_template_spec import CreateTriggerRequestTemplateSpec
        spec = self.spec.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "spec": spec,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_template_metadata import CreateTriggerRequestTemplateMetadata
        from ..models.create_trigger_request_template_spec import CreateTriggerRequestTemplateSpec
        d = dict(src_dict)
        spec = CreateTriggerRequestTemplateSpec.from_dict(d.pop("spec"))




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateTriggerRequestTemplateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateTriggerRequestTemplateMetadata.from_dict(_metadata)




        create_trigger_request_template = cls(
            spec=spec,
            metadata=metadata,
        )

        return create_trigger_request_template

