from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_trigger_request_source_type_0_type import UpdateTriggerRequestSourceType0Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_trigger_request_source_type_0_schedule import UpdateTriggerRequestSourceType0Schedule





T = TypeVar("T", bound="UpdateTriggerRequestSourceType0")



@_attrs_define
class UpdateTriggerRequestSourceType0:
    """ 
        Attributes:
            type_ (UpdateTriggerRequestSourceType0Type):
            schedule (UpdateTriggerRequestSourceType0Schedule | Unset):
     """

    type_: UpdateTriggerRequestSourceType0Type
    schedule: UpdateTriggerRequestSourceType0Schedule | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_trigger_request_source_type_0_schedule import UpdateTriggerRequestSourceType0Schedule
        type_ = self.type_.value

        schedule: dict[str, Any] | Unset = UNSET
        if not isinstance(self.schedule, Unset):
            schedule = self.schedule.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
        })
        if schedule is not UNSET:
            field_dict["schedule"] = schedule

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_trigger_request_source_type_0_schedule import UpdateTriggerRequestSourceType0Schedule
        d = dict(src_dict)
        type_ = UpdateTriggerRequestSourceType0Type(d.pop("type"))




        _schedule = d.pop("schedule", UNSET)
        schedule: UpdateTriggerRequestSourceType0Schedule | Unset
        if isinstance(_schedule,  Unset):
            schedule = UNSET
        else:
            schedule = UpdateTriggerRequestSourceType0Schedule.from_dict(_schedule)




        update_trigger_request_source_type_0 = cls(
            type_=type_,
            schedule=schedule,
        )


        update_trigger_request_source_type_0.additional_properties = d
        return update_trigger_request_source_type_0

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
