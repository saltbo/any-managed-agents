from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime import Runtime
from ..models.trigger_type import TriggerType
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
  from ..models.memory_store_resource_ref import MemoryStoreResourceRef
  from ..models.resource_ref_type_1 import ResourceRefType1
  from ..models.secret_env_entry import SecretEnvEntry
  from ..models.trigger_env import TriggerEnv
  from ..models.trigger_metadata import TriggerMetadata
  from ..models.trigger_schedule_type_0 import TriggerScheduleType0





T = TypeVar("T", bound="Trigger")



@_attrs_define
class Trigger:
    """ 
        Attributes:
            id (str):  Example: trigger_abc123.
            project_id (str):  Example: project_abc123.
            type_ (TriggerType):  Example: scheduled.
            agent_id (str):  Example: agent_abc123.
            environment_id (None | str):  Example: env_abc123.
            runtime (Runtime):  Example: codex.
            name (str):  Example: Daily research heartbeat.
            prompt_template (str):  Example: Research current Canadian banking bonus offers..
            resource_refs (list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1]):  Example:
                [{'type': 'github_repository', 'owner': 'openai', 'repo': 'openai'}].
            env (TriggerEnv):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            secret_env (list[SecretEnvEntry]):  Example: [{'name': 'AK_AGENT_KEY', 'credentialRef': {'credentialId':
                'vaultcred_abc123'}}].
            schedule (None | TriggerScheduleType0):  Example: {'type': 'interval', 'intervalSeconds': 86400,
                'windowSeconds': 0}.
            enabled (bool):  Example: True.
            next_due_at (datetime.datetime | None):  Example: 2026-05-26T12:00:00.000Z.
            last_dispatched_at (datetime.datetime | None):
            last_run_id (None | str):  Example: trigrun_abc123.
            metadata (TriggerMetadata):  Example: {'owner': 'growth'}.
            created_by_user_id (None | str):  Example: user_abc123.
            archived_at (datetime.datetime | None):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    type_: TriggerType
    agent_id: str
    environment_id: None | str
    runtime: Runtime
    name: str
    prompt_template: str
    resource_refs: list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1]
    env: TriggerEnv
    secret_env: list[SecretEnvEntry]
    schedule: None | TriggerScheduleType0
    enabled: bool
    next_due_at: datetime.datetime | None
    last_dispatched_at: datetime.datetime | None
    last_run_id: None | str
    metadata: TriggerMetadata
    created_by_user_id: None | str
    archived_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.memory_store_resource_ref import MemoryStoreResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        from ..models.trigger_env import TriggerEnv
        from ..models.trigger_metadata import TriggerMetadata
        from ..models.trigger_schedule_type_0 import TriggerScheduleType0
        id = self.id

        project_id = self.project_id

        type_ = self.type_.value

        agent_id = self.agent_id

        environment_id: None | str
        environment_id = self.environment_id

        runtime = self.runtime.value

        name = self.name

        prompt_template = self.prompt_template

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



        env = self.env.to_dict()

        secret_env = []
        for secret_env_item_data in self.secret_env:
            secret_env_item = secret_env_item_data.to_dict()
            secret_env.append(secret_env_item)



        schedule: dict[str, Any] | None
        if isinstance(self.schedule, TriggerScheduleType0):
            schedule = self.schedule.to_dict()
        else:
            schedule = self.schedule

        enabled = self.enabled

        next_due_at: None | str
        if isinstance(self.next_due_at, datetime.datetime):
            next_due_at = self.next_due_at.isoformat()
        else:
            next_due_at = self.next_due_at

        last_dispatched_at: None | str
        if isinstance(self.last_dispatched_at, datetime.datetime):
            last_dispatched_at = self.last_dispatched_at.isoformat()
        else:
            last_dispatched_at = self.last_dispatched_at

        last_run_id: None | str
        last_run_id = self.last_run_id

        metadata = self.metadata.to_dict()

        created_by_user_id: None | str
        created_by_user_id = self.created_by_user_id

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "type": type_,
            "agentId": agent_id,
            "environmentId": environment_id,
            "runtime": runtime,
            "name": name,
            "promptTemplate": prompt_template,
            "resourceRefs": resource_refs,
            "env": env,
            "secretEnv": secret_env,
            "schedule": schedule,
            "enabled": enabled,
            "nextDueAt": next_due_at,
            "lastDispatchedAt": last_dispatched_at,
            "lastRunId": last_run_id,
            "metadata": metadata,
            "createdByUserId": created_by_user_id,
            "archivedAt": archived_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.memory_store_resource_ref import MemoryStoreResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        from ..models.trigger_env import TriggerEnv
        from ..models.trigger_metadata import TriggerMetadata
        from ..models.trigger_schedule_type_0 import TriggerScheduleType0
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        type_ = TriggerType(d.pop("type"))




        agent_id = d.pop("agentId")

        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        runtime = Runtime(d.pop("runtime"))




        name = d.pop("name")

        prompt_template = d.pop("promptTemplate")

        resource_refs = []
        _resource_refs = d.pop("resourceRefs")
        for resource_refs_item_data in (_resource_refs):
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


        env = TriggerEnv.from_dict(d.pop("env"))




        secret_env = []
        _secret_env = d.pop("secretEnv")
        for secret_env_item_data in (_secret_env):
            secret_env_item = SecretEnvEntry.from_dict(secret_env_item_data)



            secret_env.append(secret_env_item)


        def _parse_schedule(data: object) -> None | TriggerScheduleType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                schedule_type_0 = TriggerScheduleType0.from_dict(data)



                return schedule_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TriggerScheduleType0, data)

        schedule = _parse_schedule(d.pop("schedule"))


        enabled = d.pop("enabled")

        def _parse_next_due_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                next_due_at_type_0 = datetime.datetime.fromisoformat(data)



                return next_due_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        next_due_at = _parse_next_due_at(d.pop("nextDueAt"))


        def _parse_last_dispatched_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_dispatched_at_type_0 = datetime.datetime.fromisoformat(data)



                return last_dispatched_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_dispatched_at = _parse_last_dispatched_at(d.pop("lastDispatchedAt"))


        def _parse_last_run_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_run_id = _parse_last_run_id(d.pop("lastRunId"))


        metadata = TriggerMetadata.from_dict(d.pop("metadata"))




        def _parse_created_by_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by_user_id = _parse_created_by_user_id(d.pop("createdByUserId"))


        def _parse_archived_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                archived_at_type_0 = datetime.datetime.fromisoformat(data)



                return archived_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))


        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        trigger = cls(
            id=id,
            project_id=project_id,
            type_=type_,
            agent_id=agent_id,
            environment_id=environment_id,
            runtime=runtime,
            name=name,
            prompt_template=prompt_template,
            resource_refs=resource_refs,
            env=env,
            secret_env=secret_env,
            schedule=schedule,
            enabled=enabled,
            next_due_at=next_due_at,
            last_dispatched_at=last_dispatched_at,
            last_run_id=last_run_id,
            metadata=metadata,
            created_by_user_id=created_by_user_id,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        trigger.additional_properties = d
        return trigger

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
