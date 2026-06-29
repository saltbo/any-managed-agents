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
  from ..models.update_trigger_request_source_type_0 import UpdateTriggerRequestSourceType0
  from ..models.update_trigger_request_source_type_1 import UpdateTriggerRequestSourceType1
  from ..models.update_trigger_request_template import UpdateTriggerRequestTemplate





T = TypeVar("T", bound="UpdateTriggerRequest")



@_attrs_define
class UpdateTriggerRequest:
    """ 
        Attributes:
            name (str | Unset):  Example: Daily research heartbeat.
            source (Unset | UpdateTriggerRequestSourceType0 | UpdateTriggerRequestSourceType1):
            suspend (bool | Unset):  Example: True.
            template (UpdateTriggerRequestTemplate | Unset):
            archived (bool | Unset):  Example: True.
            next_due_at (datetime.datetime | Unset):  Example: 2026-05-27T12:00:00.000Z.
     """

    name: str | Unset = UNSET
    source: Unset | UpdateTriggerRequestSourceType0 | UpdateTriggerRequestSourceType1 = UNSET
    suspend: bool | Unset = UNSET
    template: UpdateTriggerRequestTemplate | Unset = UNSET
    archived: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_trigger_request_source_type_0 import UpdateTriggerRequestSourceType0
        from ..models.update_trigger_request_source_type_1 import UpdateTriggerRequestSourceType1
        from ..models.update_trigger_request_template import UpdateTriggerRequestTemplate
        name = self.name

        source: dict[str, Any] | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        elif isinstance(self.source, UpdateTriggerRequestSourceType0):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()


        suspend = self.suspend

        template: dict[str, Any] | Unset = UNSET
        if not isinstance(self.template, Unset):
            template = self.template.to_dict()

        archived = self.archived

        next_due_at: str | Unset = UNSET
        if not isinstance(self.next_due_at, Unset):
            next_due_at = self.next_due_at.isoformat()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if name is not UNSET:
            field_dict["name"] = name
        if source is not UNSET:
            field_dict["source"] = source
        if suspend is not UNSET:
            field_dict["suspend"] = suspend
        if template is not UNSET:
            field_dict["template"] = template
        if archived is not UNSET:
            field_dict["archived"] = archived
        if next_due_at is not UNSET:
            field_dict["nextDueAt"] = next_due_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_trigger_request_source_type_0 import UpdateTriggerRequestSourceType0
        from ..models.update_trigger_request_source_type_1 import UpdateTriggerRequestSourceType1
        from ..models.update_trigger_request_template import UpdateTriggerRequestTemplate
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_source(data: object) -> Unset | UpdateTriggerRequestSourceType0 | UpdateTriggerRequestSourceType1:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = UpdateTriggerRequestSourceType0.from_dict(data)



                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_1 = UpdateTriggerRequestSourceType1.from_dict(data)



            return source_type_1

        source = _parse_source(d.pop("source", UNSET))


        suspend = d.pop("suspend", UNSET)

        _template = d.pop("template", UNSET)
        template: UpdateTriggerRequestTemplate | Unset
        if isinstance(_template,  Unset):
            template = UNSET
        else:
            template = UpdateTriggerRequestTemplate.from_dict(_template)




        archived = d.pop("archived", UNSET)

        _next_due_at = d.pop("nextDueAt", UNSET)
        next_due_at: datetime.datetime | Unset
        if isinstance(_next_due_at,  Unset):
            next_due_at = UNSET
        else:
            next_due_at = datetime.datetime.fromisoformat(_next_due_at)




        update_trigger_request = cls(
            name=name,
            source=source,
            suspend=suspend,
            template=template,
            archived=archived,
            next_due_at=next_due_at,
        )

        return update_trigger_request

