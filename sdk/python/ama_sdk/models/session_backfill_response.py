from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_backfill_response_type import SessionBackfillResponseType
from typing import cast

if TYPE_CHECKING:
  from ..models.session_event import SessionEvent





T = TypeVar("T", bound="SessionBackfillResponse")



@_attrs_define
class SessionBackfillResponse:
    """ 
        Attributes:
            type_ (SessionBackfillResponseType):
            request_id (None | str):
            events (list[SessionEvent]):
            next_cursor (int | None):
            has_more (bool):
     """

    type_: SessionBackfillResponseType
    request_id: None | str
    events: list[SessionEvent]
    next_cursor: int | None
    has_more: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_event import SessionEvent
        type_ = self.type_.value

        request_id: None | str
        request_id = self.request_id

        events = []
        for events_item_data in self.events:
            events_item = events_item_data.to_dict()
            events.append(events_item)



        next_cursor: int | None
        next_cursor = self.next_cursor

        has_more = self.has_more


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "requestId": request_id,
            "events": events,
            "nextCursor": next_cursor,
            "hasMore": has_more,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_event import SessionEvent
        d = dict(src_dict)
        type_ = SessionBackfillResponseType(d.pop("type"))




        def _parse_request_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        request_id = _parse_request_id(d.pop("requestId"))


        events = []
        _events = d.pop("events")
        for events_item_data in (_events):
            events_item = SessionEvent.from_dict(events_item_data)



            events.append(events_item)


        def _parse_next_cursor(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))


        has_more = d.pop("hasMore")

        session_backfill_response = cls(
            type_=type_,
            request_id=request_id,
            events=events,
            next_cursor=next_cursor,
            has_more=has_more,
        )


        session_backfill_response.additional_properties = d
        return session_backfill_response

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
