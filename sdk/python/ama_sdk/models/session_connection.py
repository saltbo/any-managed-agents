from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_connection_state import SessionConnectionState
from typing import cast






T = TypeVar("T", bound="SessionConnection")



@_attrs_define
class SessionConnection:
    """ 
        Attributes:
            session_id (str):  Example: session_abc123.
            transport (None | str): Runtime protocol the connection path speaks. Example: ama-runtime-rpc.
            path (None | str): Public runtime proxy path to reconnect to; null while no runtime endpoint is attached.
                Example: /api/v1/runtime/sessions/session_abc123/rpc.
            state (SessionConnectionState):  Example: idle.
            state_reason (None | str):
     """

    session_id: str
    transport: None | str
    path: None | str
    state: SessionConnectionState
    state_reason: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        transport: None | str
        transport = self.transport

        path: None | str
        path = self.path

        state = self.state.value

        state_reason: None | str
        state_reason = self.state_reason


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "sessionId": session_id,
            "transport": transport,
            "path": path,
            "state": state,
            "stateReason": state_reason,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionId")

        def _parse_transport(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        transport = _parse_transport(d.pop("transport"))


        def _parse_path(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        path = _parse_path(d.pop("path"))


        state = SessionConnectionState(d.pop("state"))




        def _parse_state_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        state_reason = _parse_state_reason(d.pop("stateReason"))


        session_connection = cls(
            session_id=session_id,
            transport=transport,
            path=path,
            state=state,
            state_reason=state_reason,
        )


        session_connection.additional_properties = d
        return session_connection

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
