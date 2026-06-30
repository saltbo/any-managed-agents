from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.policy_decision_payload_details import PolicyDecisionPayloadDetails





T = TypeVar("T", bound="PolicyDecisionPayload")



@_attrs_define
class PolicyDecisionPayload:
    """ 
        Attributes:
            allowed (bool):
            category (str | Unset):
            rule_id (str | Unset):
            resource_type (str | Unset):
            resource_id (str | Unset):
            operation (str | Unset):
            command (None | str | Unset):
            host (None | str | Unset):
            connector_id (str | Unset):
            tool_name (str | Unset):
            decision (str | Unset):
            details (PolicyDecisionPayloadDetails | Unset):
     """

    allowed: bool
    category: str | Unset = UNSET
    rule_id: str | Unset = UNSET
    resource_type: str | Unset = UNSET
    resource_id: str | Unset = UNSET
    operation: str | Unset = UNSET
    command: None | str | Unset = UNSET
    host: None | str | Unset = UNSET
    connector_id: str | Unset = UNSET
    tool_name: str | Unset = UNSET
    decision: str | Unset = UNSET
    details: PolicyDecisionPayloadDetails | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.policy_decision_payload_details import PolicyDecisionPayloadDetails
        allowed = self.allowed

        category = self.category

        rule_id = self.rule_id

        resource_type = self.resource_type

        resource_id = self.resource_id

        operation = self.operation

        command: None | str | Unset
        if isinstance(self.command, Unset):
            command = UNSET
        else:
            command = self.command

        host: None | str | Unset
        if isinstance(self.host, Unset):
            host = UNSET
        else:
            host = self.host

        connector_id = self.connector_id

        tool_name = self.tool_name

        decision = self.decision

        details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "allowed": allowed,
        })
        if category is not UNSET:
            field_dict["category"] = category
        if rule_id is not UNSET:
            field_dict["ruleId"] = rule_id
        if resource_type is not UNSET:
            field_dict["resourceType"] = resource_type
        if resource_id is not UNSET:
            field_dict["resourceId"] = resource_id
        if operation is not UNSET:
            field_dict["operation"] = operation
        if command is not UNSET:
            field_dict["command"] = command
        if host is not UNSET:
            field_dict["host"] = host
        if connector_id is not UNSET:
            field_dict["connectorId"] = connector_id
        if tool_name is not UNSET:
            field_dict["toolName"] = tool_name
        if decision is not UNSET:
            field_dict["decision"] = decision
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.policy_decision_payload_details import PolicyDecisionPayloadDetails
        d = dict(src_dict)
        allowed = d.pop("allowed")

        category = d.pop("category", UNSET)

        rule_id = d.pop("ruleId", UNSET)

        resource_type = d.pop("resourceType", UNSET)

        resource_id = d.pop("resourceId", UNSET)

        operation = d.pop("operation", UNSET)

        def _parse_command(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        command = _parse_command(d.pop("command", UNSET))


        def _parse_host(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        host = _parse_host(d.pop("host", UNSET))


        connector_id = d.pop("connectorId", UNSET)

        tool_name = d.pop("toolName", UNSET)

        decision = d.pop("decision", UNSET)

        _details = d.pop("details", UNSET)
        details: PolicyDecisionPayloadDetails | Unset
        if isinstance(_details,  Unset):
            details = UNSET
        else:
            details = PolicyDecisionPayloadDetails.from_dict(_details)




        policy_decision_payload = cls(
            allowed=allowed,
            category=category,
            rule_id=rule_id,
            resource_type=resource_type,
            resource_id=resource_id,
            operation=operation,
            command=command,
            host=host,
            connector_id=connector_id,
            tool_name=tool_name,
            decision=decision,
            details=details,
        )

        return policy_decision_payload

