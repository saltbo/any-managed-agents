from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.put_runner_heartbeat_request_state import PutRunnerHeartbeatRequestState
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.put_runner_heartbeat_request_metadata import PutRunnerHeartbeatRequestMetadata
  from ..models.runner_runtime_inventory import RunnerRuntimeInventory
  from ..models.runtime_usage import RuntimeUsage





T = TypeVar("T", bound="PutRunnerHeartbeatRequest")



@_attrs_define
class PutRunnerHeartbeatRequest:
    """ 
        Attributes:
            state (PutRunnerHeartbeatRequestState | Unset):  Example: active.
            capabilities (list[str] | Unset):  Example: ['node', 'git'].
            runtime_usage (list[RuntimeUsage] | Unset):
            runtime_inventory (list[RunnerRuntimeInventory] | Unset):
            metadata (PutRunnerHeartbeatRequestMetadata | Unset):  Example: {'hostname': 'runner-1'}.
     """

    state: PutRunnerHeartbeatRequestState | Unset = UNSET
    capabilities: list[str] | Unset = UNSET
    runtime_usage: list[RuntimeUsage] | Unset = UNSET
    runtime_inventory: list[RunnerRuntimeInventory] | Unset = UNSET
    metadata: PutRunnerHeartbeatRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.put_runner_heartbeat_request_metadata import PutRunnerHeartbeatRequestMetadata
        from ..models.runner_runtime_inventory import RunnerRuntimeInventory
        from ..models.runtime_usage import RuntimeUsage
        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value


        capabilities: list[str] | Unset = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities



        runtime_usage: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.runtime_usage, Unset):
            runtime_usage = []
            for runtime_usage_item_data in self.runtime_usage:
                runtime_usage_item = runtime_usage_item_data.to_dict()
                runtime_usage.append(runtime_usage_item)



        runtime_inventory: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.runtime_inventory, Unset):
            runtime_inventory = []
            for runtime_inventory_item_data in self.runtime_inventory:
                runtime_inventory_item = runtime_inventory_item_data.to_dict()
                runtime_inventory.append(runtime_inventory_item)



        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if state is not UNSET:
            field_dict["state"] = state
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities
        if runtime_usage is not UNSET:
            field_dict["runtimeUsage"] = runtime_usage
        if runtime_inventory is not UNSET:
            field_dict["runtimeInventory"] = runtime_inventory
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_runner_heartbeat_request_metadata import PutRunnerHeartbeatRequestMetadata
        from ..models.runner_runtime_inventory import RunnerRuntimeInventory
        from ..models.runtime_usage import RuntimeUsage
        d = dict(src_dict)
        _state = d.pop("state", UNSET)
        state: PutRunnerHeartbeatRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = PutRunnerHeartbeatRequestState(_state)




        capabilities = cast(list[str], d.pop("capabilities", UNSET))


        _runtime_usage = d.pop("runtimeUsage", UNSET)
        runtime_usage: list[RuntimeUsage] | Unset = UNSET
        if _runtime_usage is not UNSET:
            runtime_usage = []
            for runtime_usage_item_data in _runtime_usage:
                runtime_usage_item = RuntimeUsage.from_dict(runtime_usage_item_data)



                runtime_usage.append(runtime_usage_item)


        _runtime_inventory = d.pop("runtimeInventory", UNSET)
        runtime_inventory: list[RunnerRuntimeInventory] | Unset = UNSET
        if _runtime_inventory is not UNSET:
            runtime_inventory = []
            for runtime_inventory_item_data in _runtime_inventory:
                runtime_inventory_item = RunnerRuntimeInventory.from_dict(runtime_inventory_item_data)



                runtime_inventory.append(runtime_inventory_item)


        _metadata = d.pop("metadata", UNSET)
        metadata: PutRunnerHeartbeatRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = PutRunnerHeartbeatRequestMetadata.from_dict(_metadata)




        put_runner_heartbeat_request = cls(
            state=state,
            capabilities=capabilities,
            runtime_usage=runtime_usage,
            runtime_inventory=runtime_inventory,
            metadata=metadata,
        )

        return put_runner_heartbeat_request

