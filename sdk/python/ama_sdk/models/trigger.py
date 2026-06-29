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
  from ..models.env_from_entry import EnvFromEntry
  from ..models.git_repository_volume import GitRepositoryVolume
  from ..models.memory_volume import MemoryVolume
  from ..models.secret_volume import SecretVolume
  from ..models.trigger_env import TriggerEnv
  from ..models.trigger_metadata import TriggerMetadata
  from ..models.trigger_schedule_type_0 import TriggerScheduleType0
  from ..models.volume_mount import VolumeMount





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
            env (TriggerEnv):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            env_from (list[EnvFromEntry]):  Example: [{'type': 'secret', 'name': 'AK_AGENT_KEY', 'secretRef':
                'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123'}].
            volumes (list[GitRepositoryVolume | MemoryVolume | SecretVolume]):  Example: [{'name': 'project-secrets',
                'type': 'secret', 'secretRef': 'ama://vaults/vault_abc123'}].
            volume_mounts (list[VolumeMount]):  Example: [{'name': 'project-secrets', 'mountPath':
                '/workspace/.ama/secrets/project', 'readOnly': True}].
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
    env: TriggerEnv
    env_from: list[EnvFromEntry]
    volumes: list[GitRepositoryVolume | MemoryVolume | SecretVolume]
    volume_mounts: list[VolumeMount]
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
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.trigger_env import TriggerEnv
        from ..models.trigger_metadata import TriggerMetadata
        from ..models.trigger_schedule_type_0 import TriggerScheduleType0
        from ..models.volume_mount import VolumeMount
        id = self.id

        project_id = self.project_id

        type_ = self.type_.value

        agent_id = self.agent_id

        environment_id: None | str
        environment_id = self.environment_id

        runtime = self.runtime.value

        name = self.name

        prompt_template = self.prompt_template

        env = self.env.to_dict()

        env_from = []
        for env_from_item_data in self.env_from:
            env_from_item = env_from_item_data.to_dict()
            env_from.append(env_from_item)



        volumes = []
        for volumes_item_data in self.volumes:
            volumes_item: dict[str, Any]
            if isinstance(volumes_item_data, SecretVolume):
                volumes_item = volumes_item_data.to_dict()
            elif isinstance(volumes_item_data, GitRepositoryVolume):
                volumes_item = volumes_item_data.to_dict()
            else:
                volumes_item = volumes_item_data.to_dict()

            volumes.append(volumes_item)



        volume_mounts = []
        for volume_mounts_item_data in self.volume_mounts:
            volume_mounts_item = volume_mounts_item_data.to_dict()
            volume_mounts.append(volume_mounts_item)



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
            "env": env,
            "envFrom": env_from,
            "volumes": volumes,
            "volumeMounts": volume_mounts,
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
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.trigger_env import TriggerEnv
        from ..models.trigger_metadata import TriggerMetadata
        from ..models.trigger_schedule_type_0 import TriggerScheduleType0
        from ..models.volume_mount import VolumeMount
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

        env = TriggerEnv.from_dict(d.pop("env"))




        env_from = []
        _env_from = d.pop("envFrom")
        for env_from_item_data in (_env_from):
            env_from_item = EnvFromEntry.from_dict(env_from_item_data)



            env_from.append(env_from_item)


        volumes = []
        _volumes = d.pop("volumes")
        for volumes_item_data in (_volumes):
            def _parse_volumes_item(data: object) -> GitRepositoryVolume | MemoryVolume | SecretVolume:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_volume_type_0 = SecretVolume.from_dict(data)



                    return componentsschemas_volume_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_volume_type_1 = GitRepositoryVolume.from_dict(data)



                    return componentsschemas_volume_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_volume_type_2 = MemoryVolume.from_dict(data)



                return componentsschemas_volume_type_2

            volumes_item = _parse_volumes_item(volumes_item_data)

            volumes.append(volumes_item)


        volume_mounts = []
        _volume_mounts = d.pop("volumeMounts")
        for volume_mounts_item_data in (_volume_mounts):
            volume_mounts_item = VolumeMount.from_dict(volume_mounts_item_data)



            volume_mounts.append(volume_mounts_item)


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
            env=env,
            env_from=env_from,
            volumes=volumes,
            volume_mounts=volume_mounts,
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
