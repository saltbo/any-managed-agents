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
  from ..models.env_from_entry import EnvFromEntry
  from ..models.git_repository_volume import GitRepositoryVolume
  from ..models.memory_volume import MemoryVolume
  from ..models.secret_volume import SecretVolume
  from ..models.volume_mount import VolumeMount





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
            env (CreateTriggerRequestEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            env_from (list[EnvFromEntry] | Unset):  Example: [{'type': 'secret', 'name': 'AK_AGENT_KEY', 'secretRef':
                'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123'}].
            volumes (list[GitRepositoryVolume | MemoryVolume | SecretVolume] | Unset):
            volume_mounts (list[VolumeMount] | Unset):
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
    env: CreateTriggerRequestEnv | Unset = UNSET
    env_from: list[EnvFromEntry] | Unset = UNSET
    volumes: list[GitRepositoryVolume | MemoryVolume | SecretVolume] | Unset = UNSET
    volume_mounts: list[VolumeMount] | Unset = UNSET
    schedule: CreateTriggerRequestScheduleType0 | None | Unset = UNSET
    enabled: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET
    metadata: CreateTriggerRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_env import CreateTriggerRequestEnv
        from ..models.create_trigger_request_metadata import CreateTriggerRequestMetadata
        from ..models.create_trigger_request_schedule_type_0 import CreateTriggerRequestScheduleType0
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
        agent_id = self.agent_id

        runtime = self.runtime.value

        name = self.name

        prompt_template = self.prompt_template

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value


        environment_id = self.environment_id

        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        env_from: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.env_from, Unset):
            env_from = []
            for env_from_item_data in self.env_from:
                env_from_item = env_from_item_data.to_dict()
                env_from.append(env_from_item)



        volumes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.volumes, Unset):
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



        volume_mounts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.volume_mounts, Unset):
            volume_mounts = []
            for volume_mounts_item_data in self.volume_mounts:
                volume_mounts_item = volume_mounts_item_data.to_dict()
                volume_mounts.append(volume_mounts_item)



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
        if env is not UNSET:
            field_dict["env"] = env
        if env_from is not UNSET:
            field_dict["envFrom"] = env_from
        if volumes is not UNSET:
            field_dict["volumes"] = volumes
        if volume_mounts is not UNSET:
            field_dict["volumeMounts"] = volume_mounts
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
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
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

        _env = d.pop("env", UNSET)
        env: CreateTriggerRequestEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = CreateTriggerRequestEnv.from_dict(_env)




        _env_from = d.pop("envFrom", UNSET)
        env_from: list[EnvFromEntry] | Unset = UNSET
        if _env_from is not UNSET:
            env_from = []
            for env_from_item_data in _env_from:
                env_from_item = EnvFromEntry.from_dict(env_from_item_data)



                env_from.append(env_from_item)


        _volumes = d.pop("volumes", UNSET)
        volumes: list[GitRepositoryVolume | MemoryVolume | SecretVolume] | Unset = UNSET
        if _volumes is not UNSET:
            volumes = []
            for volumes_item_data in _volumes:
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


        _volume_mounts = d.pop("volumeMounts", UNSET)
        volume_mounts: list[VolumeMount] | Unset = UNSET
        if _volume_mounts is not UNSET:
            volume_mounts = []
            for volume_mounts_item_data in _volume_mounts:
                volume_mounts_item = VolumeMount.from_dict(volume_mounts_item_data)



                volume_mounts.append(volume_mounts_item)


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
            env=env,
            env_from=env_from,
            volumes=volumes,
            volume_mounts=volume_mounts,
            schedule=schedule,
            enabled=enabled,
            next_due_at=next_due_at,
            metadata=metadata,
        )

        return create_trigger_request

