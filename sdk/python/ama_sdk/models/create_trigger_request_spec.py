from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_trigger_request_spec_source_type_0 import CreateTriggerRequestSpecSourceType0
  from ..models.create_trigger_request_spec_source_type_1 import CreateTriggerRequestSpecSourceType1
  from ..models.create_trigger_request_spec_template import CreateTriggerRequestSpecTemplate





T = TypeVar("T", bound="CreateTriggerRequestSpec")



@_attrs_define
class CreateTriggerRequestSpec:
    """ 
        Attributes:
            source (CreateTriggerRequestSpecSourceType0 | CreateTriggerRequestSpecSourceType1):
            template (CreateTriggerRequestSpecTemplate):
            suspend (bool | Unset):
     """

    source: CreateTriggerRequestSpecSourceType0 | CreateTriggerRequestSpecSourceType1
    template: CreateTriggerRequestSpecTemplate
    suspend: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_spec_source_type_0 import CreateTriggerRequestSpecSourceType0
        from ..models.create_trigger_request_spec_source_type_1 import CreateTriggerRequestSpecSourceType1
        from ..models.create_trigger_request_spec_template import CreateTriggerRequestSpecTemplate
        source: dict[str, Any]
        if isinstance(self.source, CreateTriggerRequestSpecSourceType0):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()


        template = self.template.to_dict()

        suspend = self.suspend


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "source": source,
            "template": template,
        })
        if suspend is not UNSET:
            field_dict["suspend"] = suspend

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_spec_source_type_0 import CreateTriggerRequestSpecSourceType0
        from ..models.create_trigger_request_spec_source_type_1 import CreateTriggerRequestSpecSourceType1
        from ..models.create_trigger_request_spec_template import CreateTriggerRequestSpecTemplate
        d = dict(src_dict)
        def _parse_source(data: object) -> CreateTriggerRequestSpecSourceType0 | CreateTriggerRequestSpecSourceType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = CreateTriggerRequestSpecSourceType0.from_dict(data)



                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_1 = CreateTriggerRequestSpecSourceType1.from_dict(data)



            return source_type_1

        source = _parse_source(d.pop("source"))


        template = CreateTriggerRequestSpecTemplate.from_dict(d.pop("template"))




        suspend = d.pop("suspend", UNSET)

        create_trigger_request_spec = cls(
            source=source,
            template=template,
            suspend=suspend,
        )

        return create_trigger_request_spec

