from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.tool_call_state import ToolCallState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.tool_call_error_type_0 import ToolCallErrorType0
  from ..models.tool_call_input import ToolCallInput
  from ..models.tool_call_output_type_0 import ToolCallOutputType0





T = TypeVar("T", bound="ToolCall")



@_attrs_define
class ToolCall:
    """ 
        Attributes:
            id (str):
            connection_id (str):
            connector_id (str):
            tool_name (str):
            session_id (str):
            state (ToolCallState):
            input_ (ToolCallInput):
            output (None | ToolCallOutputType0):
            error (None | ToolCallErrorType0):
            duration_ms (int):
            created_at (datetime.datetime):
     """

    id: str
    connection_id: str
    connector_id: str
    tool_name: str
    session_id: str
    state: ToolCallState
    input_: ToolCallInput
    output: None | ToolCallOutputType0
    error: None | ToolCallErrorType0
    duration_ms: int
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.tool_call_error_type_0 import ToolCallErrorType0
        from ..models.tool_call_input import ToolCallInput
        from ..models.tool_call_output_type_0 import ToolCallOutputType0
        id = self.id

        connection_id = self.connection_id

        connector_id = self.connector_id

        tool_name = self.tool_name

        session_id = self.session_id

        state = self.state.value

        input_ = self.input_.to_dict()

        output: dict[str, Any] | None
        if isinstance(self.output, ToolCallOutputType0):
            output = self.output.to_dict()
        else:
            output = self.output

        error: dict[str, Any] | None
        if isinstance(self.error, ToolCallErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        duration_ms = self.duration_ms

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "connectionId": connection_id,
            "connectorId": connector_id,
            "toolName": tool_name,
            "sessionId": session_id,
            "state": state,
            "input": input_,
            "output": output,
            "error": error,
            "durationMs": duration_ms,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.tool_call_error_type_0 import ToolCallErrorType0
        from ..models.tool_call_input import ToolCallInput
        from ..models.tool_call_output_type_0 import ToolCallOutputType0
        d = dict(src_dict)
        id = d.pop("id")

        connection_id = d.pop("connectionId")

        connector_id = d.pop("connectorId")

        tool_name = d.pop("toolName")

        session_id = d.pop("sessionId")

        state = ToolCallState(d.pop("state"))




        input_ = ToolCallInput.from_dict(d.pop("input"))




        def _parse_output(data: object) -> None | ToolCallOutputType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                output_type_0 = ToolCallOutputType0.from_dict(data)



                return output_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | ToolCallOutputType0, data)

        output = _parse_output(d.pop("output"))


        def _parse_error(data: object) -> None | ToolCallErrorType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_tool_call_error_type_0 = ToolCallErrorType0.from_dict(data)



                return componentsschemas_tool_call_error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | ToolCallErrorType0, data)

        error = _parse_error(d.pop("error"))


        duration_ms = d.pop("durationMs")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        tool_call = cls(
            id=id,
            connection_id=connection_id,
            connector_id=connector_id,
            tool_name=tool_name,
            session_id=session_id,
            state=state,
            input_=input_,
            output=output,
            error=error,
            duration_ms=duration_ms,
            created_at=created_at,
        )


        tool_call.additional_properties = d
        return tool_call

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
