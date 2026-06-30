from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_trigger_request_spec_source_type_0 import UpdateTriggerRequestSpecSourceType0
  from ..models.update_trigger_request_spec_source_type_1 import UpdateTriggerRequestSpecSourceType1
  from ..models.update_trigger_request_spec_template import UpdateTriggerRequestSpecTemplate





T = TypeVar("T", bound="UpdateTriggerRequestSpec")



@_attrs_define
class UpdateTriggerRequestSpec:
    """ 
        Attributes:
            source (Unset | UpdateTriggerRequestSpecSourceType0 | UpdateTriggerRequestSpecSourceType1):
            suspend (bool | Unset):  Example: True.
            template (UpdateTriggerRequestSpecTemplate | Unset):
     """

    source: Unset | UpdateTriggerRequestSpecSourceType0 | UpdateTriggerRequestSpecSourceType1 = UNSET
    suspend: bool | Unset = UNSET
    template: UpdateTriggerRequestSpecTemplate | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_trigger_request_spec_source_type_0 import UpdateTriggerRequestSpecSourceType0
        from ..models.update_trigger_request_spec_source_type_1 import UpdateTriggerRequestSpecSourceType1
        from ..models.update_trigger_request_spec_template import UpdateTriggerRequestSpecTemplate
        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, UpdateTriggerRequestSpecSourceType0):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()


        suspend = self.suspend

        template: dict[str, Any] | Unset = UNSET
        if not isinstance(self.template, Unset):
            template = self.template.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if source is not UNSET:
            field_dict["source"] = source
        if suspend is not UNSET:
            field_dict["suspend"] = suspend
        if template is not UNSET:
            field_dict["template"] = template

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_trigger_request_spec_source_type_0 import UpdateTriggerRequestSpecSourceType0
        from ..models.update_trigger_request_spec_source_type_1 import UpdateTriggerRequestSpecSourceType1
        from ..models.update_trigger_request_spec_template import UpdateTriggerRequestSpecTemplate
        d = dict(src_dict)
        def _parse_source(data: object) -> Unset | UpdateTriggerRequestSpecSourceType0 | UpdateTriggerRequestSpecSourceType1:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = UpdateTriggerRequestSpecSourceType0.from_dict(data)



                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_1 = UpdateTriggerRequestSpecSourceType1.from_dict(data)



            return source_type_1

        source = _parse_source(d.pop("source", UNSET))


        suspend = d.pop("suspend", UNSET)

        _template = d.pop("template", UNSET)
        template: UpdateTriggerRequestSpecTemplate | Unset
        if isinstance(_template,  Unset):
            template = UNSET
        else:
            template = UpdateTriggerRequestSpecTemplate.from_dict(_template)




        update_trigger_request_spec = cls(
            source=source,
            suspend=suspend,
            template=template,
        )

        return update_trigger_request_spec

