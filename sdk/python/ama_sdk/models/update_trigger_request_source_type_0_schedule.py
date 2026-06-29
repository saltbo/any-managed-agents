from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_trigger_request_source_type_0_schedule_type import UpdateTriggerRequestSourceType0ScheduleType
from ..types import UNSET, Unset






T = TypeVar("T", bound="UpdateTriggerRequestSourceType0Schedule")



@_attrs_define
class UpdateTriggerRequestSourceType0Schedule:
    """ 
        Attributes:
            type_ (UpdateTriggerRequestSourceType0ScheduleType | Unset):  Example: interval.
            interval_seconds (int | Unset):  Example: 86400.
            window_seconds (int | Unset):
     """

    type_: UpdateTriggerRequestSourceType0ScheduleType | Unset = UNSET
    interval_seconds: int | Unset = UNSET
    window_seconds: int | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value


        interval_seconds = self.interval_seconds

        window_seconds = self.window_seconds


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if type_ is not UNSET:
            field_dict["type"] = type_
        if interval_seconds is not UNSET:
            field_dict["intervalSeconds"] = interval_seconds
        if window_seconds is not UNSET:
            field_dict["windowSeconds"] = window_seconds

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _type_ = d.pop("type", UNSET)
        type_: UpdateTriggerRequestSourceType0ScheduleType | Unset
        if isinstance(_type_,  Unset):
            type_ = UNSET
        else:
            type_ = UpdateTriggerRequestSourceType0ScheduleType(_type_)




        interval_seconds = d.pop("intervalSeconds", UNSET)

        window_seconds = d.pop("windowSeconds", UNSET)

        update_trigger_request_source_type_0_schedule = cls(
            type_=type_,
            interval_seconds=interval_seconds,
            window_seconds=window_seconds,
        )

        return update_trigger_request_source_type_0_schedule

