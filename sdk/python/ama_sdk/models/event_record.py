from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.ama_event_type_0 import AmaEventType0
  from ..models.ama_event_type_1 import AmaEventType1
  from ..models.ama_event_type_10 import AmaEventType10
  from ..models.ama_event_type_11 import AmaEventType11
  from ..models.ama_event_type_2 import AmaEventType2
  from ..models.ama_event_type_3 import AmaEventType3
  from ..models.ama_event_type_4 import AmaEventType4
  from ..models.ama_event_type_5 import AmaEventType5
  from ..models.ama_event_type_6 import AmaEventType6
  from ..models.ama_event_type_7 import AmaEventType7
  from ..models.ama_event_type_8 import AmaEventType8
  from ..models.ama_event_type_9 import AmaEventType9





T = TypeVar("T", bound="EventRecord")



@_attrs_define
class EventRecord:
    """ 
        Attributes:
            id (str):
            session_id (str):
            sequence (int):
            event (AmaEventType0 | AmaEventType1 | AmaEventType10 | AmaEventType11 | AmaEventType2 | AmaEventType3 |
                AmaEventType4 | AmaEventType5 | AmaEventType6 | AmaEventType7 | AmaEventType8 | AmaEventType9):
            created_at (datetime.datetime):
     """

    id: str
    session_id: str
    sequence: int
    event: AmaEventType0 | AmaEventType1 | AmaEventType10 | AmaEventType11 | AmaEventType2 | AmaEventType3 | AmaEventType4 | AmaEventType5 | AmaEventType6 | AmaEventType7 | AmaEventType8 | AmaEventType9
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.ama_event_type_0 import AmaEventType0
        from ..models.ama_event_type_1 import AmaEventType1
        from ..models.ama_event_type_10 import AmaEventType10
        from ..models.ama_event_type_11 import AmaEventType11
        from ..models.ama_event_type_2 import AmaEventType2
        from ..models.ama_event_type_3 import AmaEventType3
        from ..models.ama_event_type_4 import AmaEventType4
        from ..models.ama_event_type_5 import AmaEventType5
        from ..models.ama_event_type_6 import AmaEventType6
        from ..models.ama_event_type_7 import AmaEventType7
        from ..models.ama_event_type_8 import AmaEventType8
        from ..models.ama_event_type_9 import AmaEventType9
        id = self.id

        session_id = self.session_id

        sequence = self.sequence

        event: dict[str, Any]
        if isinstance(self.event, AmaEventType0):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType1):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType2):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType3):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType4):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType5):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType6):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType7):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType8):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType9):
            event = self.event.to_dict()
        elif isinstance(self.event, AmaEventType10):
            event = self.event.to_dict()
        else:
            event = self.event.to_dict()


        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "sessionId": session_id,
            "sequence": sequence,
            "event": event,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.ama_event_type_0 import AmaEventType0
        from ..models.ama_event_type_1 import AmaEventType1
        from ..models.ama_event_type_10 import AmaEventType10
        from ..models.ama_event_type_11 import AmaEventType11
        from ..models.ama_event_type_2 import AmaEventType2
        from ..models.ama_event_type_3 import AmaEventType3
        from ..models.ama_event_type_4 import AmaEventType4
        from ..models.ama_event_type_5 import AmaEventType5
        from ..models.ama_event_type_6 import AmaEventType6
        from ..models.ama_event_type_7 import AmaEventType7
        from ..models.ama_event_type_8 import AmaEventType8
        from ..models.ama_event_type_9 import AmaEventType9
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionId")

        sequence = d.pop("sequence")

        def _parse_event(data: object) -> AmaEventType0 | AmaEventType1 | AmaEventType10 | AmaEventType11 | AmaEventType2 | AmaEventType3 | AmaEventType4 | AmaEventType5 | AmaEventType6 | AmaEventType7 | AmaEventType8 | AmaEventType9:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_0 = AmaEventType0.from_dict(data)



                return componentsschemas_ama_event_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_1 = AmaEventType1.from_dict(data)



                return componentsschemas_ama_event_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_2 = AmaEventType2.from_dict(data)



                return componentsschemas_ama_event_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_3 = AmaEventType3.from_dict(data)



                return componentsschemas_ama_event_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_4 = AmaEventType4.from_dict(data)



                return componentsschemas_ama_event_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_5 = AmaEventType5.from_dict(data)



                return componentsschemas_ama_event_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_6 = AmaEventType6.from_dict(data)



                return componentsschemas_ama_event_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_7 = AmaEventType7.from_dict(data)



                return componentsschemas_ama_event_type_7
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_8 = AmaEventType8.from_dict(data)



                return componentsschemas_ama_event_type_8
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_9 = AmaEventType9.from_dict(data)



                return componentsschemas_ama_event_type_9
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_ama_event_type_10 = AmaEventType10.from_dict(data)



                return componentsschemas_ama_event_type_10
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_ama_event_type_11 = AmaEventType11.from_dict(data)



            return componentsschemas_ama_event_type_11

        event = _parse_event(d.pop("event"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        event_record = cls(
            id=id,
            session_id=session_id,
            sequence=sequence,
            event=event,
            created_at=created_at,
        )


        event_record.additional_properties = d
        return event_record

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
