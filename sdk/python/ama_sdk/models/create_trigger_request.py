from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_trigger_request_type import CreateTriggerRequestType
from ..models.runtime import Runtime
from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.create_trigger_request_env import CreateTriggerRequestEnv
  from ..models.create_trigger_request_metadata import CreateTriggerRequestMetadata
  from ..models.create_trigger_request_schedule_type_0 import CreateTriggerRequestScheduleType0
  from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
  from ..models.memory_store_resource_ref import MemoryStoreResourceRef
  from ..models.resource_ref_type_1 import ResourceRefType1
  from ..models.secret_env_entry import SecretEnvEntry





T = TypeVar("T", bound="CreateTriggerRequest")



@_attrs_define
class CreateTriggerRequest:
    """ 
        Attributes:
            agent_id (str):  Example: agent_abc123.
            runtime (Runtime):  Example: codex.
            name (str):  Example: Daily research heartbeat.
            prompt_template (str):  Example: Research current Canadian banking bonus offers..
            type_ (CreateTriggerRequestType | Unset):  Example: scheduled.
            environment_id (str | Unset):  Example: env_abc123.
            resource_refs (list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1] | Unset):  Example:
                [{'type': 'github_repository', 'owner': 'openai', 'repo': 'openai'}].
            env (CreateTriggerRequestEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            secret_env (list[SecretEnvEntry] | Unset):  Example: [{'name': 'AK_AGENT_KEY', 'credentialRef': {'credentialId':
                'vaultcred_abc123'}}].
            schedule (CreateTriggerRequestScheduleType0 | None | Unset):
            enabled (bool | Unset):  Example: True.
            next_due_at (datetime.datetime | Unset):  Example: 2026-05-26T12:00:00.000Z.
            metadata (CreateTriggerRequestMetadata | Unset):  Example: {'owner': 'growth'}.
     """

    agent_id: str
    runtime: Runtime
    name: str
    prompt_template: str
    type_: CreateTriggerRequestType | Unset = UNSET
    environment_id: str | Unset = UNSET
    resource_refs: list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1] | Unset = UNSET
    env: CreateTriggerRequestEnv | Unset = UNSET
    secret_env: list[SecretEnvEntry] | Unset = UNSET
    schedule: CreateTriggerRequestScheduleType0 | None | Unset = UNSET
    enabled: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET
    metadata: CreateTriggerRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_env import CreateTriggerRequestEnv
        from ..models.create_trigger_request_metadata import CreateTriggerRequestMetadata
        from ..models.create_trigger_request_schedule_type_0 import CreateTriggerRequestScheduleType0
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.memory_store_resource_ref import MemoryStoreResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        agent_id = self.agent_id

        runtime = self.runtime.value

        name = self.name

        prompt_template = self.prompt_template

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value


        environment_id = self.environment_id

        resource_refs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.resource_refs, Unset):
            resource_refs = []
            for resource_refs_item_data in self.resource_refs:
                resource_refs_item: dict[str, Any]
                if isinstance(resource_refs_item_data, GitHubRepositoryResourceRef):
                    resource_refs_item = resource_refs_item_data.to_dict()
                elif isinstance(resource_refs_item_data, ResourceRefType1):
                    resource_refs_item = resource_refs_item_data.to_dict()
                else:
                    resource_refs_item = resource_refs_item_data.to_dict()

                resource_refs.append(resource_refs_item)



        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        secret_env: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.secret_env, Unset):
            secret_env = []
            for secret_env_item_data in self.secret_env:
                secret_env_item = secret_env_item_data.to_dict()
                secret_env.append(secret_env_item)



        schedule: dict[str, Any] | None | Unset
        if isinstance(self.schedule, Unset):
            schedule = UNSET
        elif isinstance(self.schedule, CreateTriggerRequestScheduleType0):
            schedule = self.schedule.to_dict()
        else:
            schedule = self.schedule

        enabled = self.enabled

        next_due_at: str | Unset = UNSET
        if not isinstance(self.next_due_at, Unset):
            next_due_at = self.next_due_at.isoformat()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "runtime": runtime,
            "name": name,
            "promptTemplate": prompt_template,
        })
        if type_ is not UNSET:
            field_dict["type"] = type_
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if resource_refs is not UNSET:
            field_dict["resourceRefs"] = resource_refs
        if env is not UNSET:
            field_dict["env"] = env
        if secret_env is not UNSET:
            field_dict["secretEnv"] = secret_env
        if schedule is not UNSET:
            field_dict["schedule"] = schedule
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if next_due_at is not UNSET:
            field_dict["nextDueAt"] = next_due_at
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_env import CreateTriggerRequestEnv
        from ..models.create_trigger_request_metadata import CreateTriggerRequestMetadata
        from ..models.create_trigger_request_schedule_type_0 import CreateTriggerRequestScheduleType0
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.memory_store_resource_ref import MemoryStoreResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        runtime = Runtime(d.pop("runtime"))




        name = d.pop("name")

        prompt_template = d.pop("promptTemplate")

        _type_ = d.pop("type", UNSET)
        type_: CreateTriggerRequestType | Unset
        if isinstance(_type_,  Unset):
            type_ = UNSET
        else:
            type_ = CreateTriggerRequestType(_type_)




        environment_id = d.pop("environmentId", UNSET)

        _resource_refs = d.pop("resourceRefs", UNSET)
        resource_refs: list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1] | Unset = UNSET
        if _resource_refs is not UNSET:
            resource_refs = []
            for resource_refs_item_data in _resource_refs:
                def _parse_resource_refs_item(data: object) -> GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1:
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_resource_ref_type_0 = GitHubRepositoryResourceRef.from_dict(data)



                        return componentsschemas_resource_ref_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_resource_ref_type_1 = ResourceRefType1.from_dict(data)



                        return componentsschemas_resource_ref_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_resource_ref_type_2 = MemoryStoreResourceRef.from_dict(data)



                    return componentsschemas_resource_ref_type_2

                resource_refs_item = _parse_resource_refs_item(resource_refs_item_data)

                resource_refs.append(resource_refs_item)


        _env = d.pop("env", UNSET)
        env: CreateTriggerRequestEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = CreateTriggerRequestEnv.from_dict(_env)




        _secret_env = d.pop("secretEnv", UNSET)
        secret_env: list[SecretEnvEntry] | Unset = UNSET
        if _secret_env is not UNSET:
            secret_env = []
            for secret_env_item_data in _secret_env:
                secret_env_item = SecretEnvEntry.from_dict(secret_env_item_data)



                secret_env.append(secret_env_item)


        def _parse_schedule(data: object) -> CreateTriggerRequestScheduleType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                schedule_type_0 = CreateTriggerRequestScheduleType0.from_dict(data)



                return schedule_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(CreateTriggerRequestScheduleType0 | None | Unset, data)

        schedule = _parse_schedule(d.pop("schedule", UNSET))


        enabled = d.pop("enabled", UNSET)

        _next_due_at = d.pop("nextDueAt", UNSET)
        next_due_at: datetime.datetime | Unset
        if isinstance(_next_due_at,  Unset):
            next_due_at = UNSET
        else:
            next_due_at = datetime.datetime.fromisoformat(_next_due_at)




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateTriggerRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateTriggerRequestMetadata.from_dict(_metadata)




        create_trigger_request = cls(
            agent_id=agent_id,
            runtime=runtime,
            name=name,
            prompt_template=prompt_template,
            type_=type_,
            environment_id=environment_id,
            resource_refs=resource_refs,
            env=env,
            secret_env=secret_env,
            schedule=schedule,
            enabled=enabled,
            next_due_at=next_due_at,
            metadata=metadata,
        )

        return create_trigger_request

