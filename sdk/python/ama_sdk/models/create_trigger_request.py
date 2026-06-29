from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.create_trigger_request_source_type_0 import CreateTriggerRequestSourceType0
  from ..models.create_trigger_request_source_type_1 import CreateTriggerRequestSourceType1
  from ..models.create_trigger_request_template import CreateTriggerRequestTemplate





T = TypeVar("T", bound="CreateTriggerRequest")



@_attrs_define
class CreateTriggerRequest:
    """ 
        Attributes:
            name (str):  Example: Daily research heartbeat.
            source (CreateTriggerRequestSourceType0 | CreateTriggerRequestSourceType1):
            template (CreateTriggerRequestTemplate):
            suspend (bool | Unset):
            next_due_at (datetime.datetime | Unset):  Example: 2026-05-26T12:00:00.000Z.
     """

    name: str
    source: CreateTriggerRequestSourceType0 | CreateTriggerRequestSourceType1
    template: CreateTriggerRequestTemplate
    suspend: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_source_type_0 import CreateTriggerRequestSourceType0
        from ..models.create_trigger_request_source_type_1 import CreateTriggerRequestSourceType1
        from ..models.create_trigger_request_template import CreateTriggerRequestTemplate
        name = self.name

        source: dict[str, Any]
        if isinstance(self.source, CreateTriggerRequestSourceType0):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()


        template = self.template.to_dict()

        suspend = self.suspend

        next_due_at: str | Unset = UNSET
        if not isinstance(self.next_due_at, Unset):
            next_due_at = self.next_due_at.isoformat()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "source": source,
            "template": template,
        })
        if suspend is not UNSET:
            field_dict["suspend"] = suspend
        if next_due_at is not UNSET:
            field_dict["nextDueAt"] = next_due_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_source_type_0 import CreateTriggerRequestSourceType0
        from ..models.create_trigger_request_source_type_1 import CreateTriggerRequestSourceType1
        from ..models.create_trigger_request_template import CreateTriggerRequestTemplate
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_source(data: object) -> CreateTriggerRequestSourceType0 | CreateTriggerRequestSourceType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = CreateTriggerRequestSourceType0.from_dict(data)



                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_1 = CreateTriggerRequestSourceType1.from_dict(data)



            return source_type_1

        source = _parse_source(d.pop("source"))


        template = CreateTriggerRequestTemplate.from_dict(d.pop("template"))




        suspend = d.pop("suspend", UNSET)

        _next_due_at = d.pop("nextDueAt", UNSET)
        next_due_at: datetime.datetime | Unset
        if isinstance(_next_due_at,  Unset):
            next_due_at = UNSET
        else:
            next_due_at = datetime.datetime.fromisoformat(_next_due_at)




        create_trigger_request = cls(
            name=name,
            source=source,
            template=template,
            suspend=suspend,
            next_due_at=next_due_at,
        )

        return create_trigger_request

