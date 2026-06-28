from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime import Runtime
from ..models.update_trigger_request_type import UpdateTriggerRequestType
from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.env_from_entry import EnvFromEntry
  from ..models.git_hub_repository_volume import GitHubRepositoryVolume
  from ..models.memory_store_volume import MemoryStoreVolume
  from ..models.secret_volume import SecretVolume
  from ..models.update_trigger_request_env import UpdateTriggerRequestEnv
  from ..models.update_trigger_request_metadata import UpdateTriggerRequestMetadata
  from ..models.update_trigger_request_schedule_type_0 import UpdateTriggerRequestScheduleType0
  from ..models.volume_mount import VolumeMount





T = TypeVar("T", bound="UpdateTriggerRequest")



@_attrs_define
class UpdateTriggerRequest:
    """ 
        Attributes:
            type_ (UpdateTriggerRequestType | Unset):  Example: http.
            agent_id (str | Unset):  Example: agent_abc123.
            environment_id (str | Unset):  Example: env_abc123.
            runtime (Runtime | Unset):  Example: codex.
            name (str | Unset):  Example: Daily research heartbeat.
            prompt_template (str | Unset):  Example: Research current Canadian banking bonus offers..
            env (UpdateTriggerRequestEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            env_from (list[EnvFromEntry] | Unset):  Example: [{'type': 'secret', 'name': 'AK_AGENT_KEY', 'secretRef':
                'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123'}].
            volumes (list[GitHubRepositoryVolume | MemoryStoreVolume | SecretVolume] | Unset):
            volume_mounts (list[VolumeMount] | Unset):
            schedule (None | Unset | UpdateTriggerRequestScheduleType0):
            enabled (bool | Unset):
            archived (bool | Unset):  Example: True.
            next_due_at (datetime.datetime | Unset):  Example: 2026-05-27T12:00:00.000Z.
            metadata (UpdateTriggerRequestMetadata | Unset):  Example: {'owner': 'growth'}.
     """

    type_: UpdateTriggerRequestType | Unset = UNSET
    agent_id: str | Unset = UNSET
    environment_id: str | Unset = UNSET
    runtime: Runtime | Unset = UNSET
    name: str | Unset = UNSET
    prompt_template: str | Unset = UNSET
    env: UpdateTriggerRequestEnv | Unset = UNSET
    env_from: list[EnvFromEntry] | Unset = UNSET
    volumes: list[GitHubRepositoryVolume | MemoryStoreVolume | SecretVolume] | Unset = UNSET
    volume_mounts: list[VolumeMount] | Unset = UNSET
    schedule: None | Unset | UpdateTriggerRequestScheduleType0 = UNSET
    enabled: bool | Unset = UNSET
    archived: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET
    metadata: UpdateTriggerRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_hub_repository_volume import GitHubRepositoryVolume
        from ..models.memory_store_volume import MemoryStoreVolume
        from ..models.secret_volume import SecretVolume
        from ..models.update_trigger_request_env import UpdateTriggerRequestEnv
        from ..models.update_trigger_request_metadata import UpdateTriggerRequestMetadata
        from ..models.update_trigger_request_schedule_type_0 import UpdateTriggerRequestScheduleType0
        from ..models.volume_mount import VolumeMount
        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value


        agent_id = self.agent_id

        environment_id = self.environment_id

        runtime: str | Unset = UNSET
        if not isinstance(self.runtime, Unset):
            runtime = self.runtime.value


        name = self.name

        prompt_template = self.prompt_template

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
                elif isinstance(volumes_item_data, GitHubRepositoryVolume):
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
        elif isinstance(self.schedule, UpdateTriggerRequestScheduleType0):
            schedule = self.schedule.to_dict()
        else:
            schedule = self.schedule

        enabled = self.enabled

        archived = self.archived

        next_due_at: str | Unset = UNSET
        if not isinstance(self.next_due_at, Unset):
            next_due_at = self.next_due_at.isoformat()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if type_ is not UNSET:
            field_dict["type"] = type_
        if agent_id is not UNSET:
            field_dict["agentId"] = agent_id
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if runtime is not UNSET:
            field_dict["runtime"] = runtime
        if name is not UNSET:
            field_dict["name"] = name
        if prompt_template is not UNSET:
            field_dict["promptTemplate"] = prompt_template
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
        if archived is not UNSET:
            field_dict["archived"] = archived
        if next_due_at is not UNSET:
            field_dict["nextDueAt"] = next_due_at
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_hub_repository_volume import GitHubRepositoryVolume
        from ..models.memory_store_volume import MemoryStoreVolume
        from ..models.secret_volume import SecretVolume
        from ..models.update_trigger_request_env import UpdateTriggerRequestEnv
        from ..models.update_trigger_request_metadata import UpdateTriggerRequestMetadata
        from ..models.update_trigger_request_schedule_type_0 import UpdateTriggerRequestScheduleType0
        from ..models.volume_mount import VolumeMount
        d = dict(src_dict)
        _type_ = d.pop("type", UNSET)
        type_: UpdateTriggerRequestType | Unset
        if isinstance(_type_,  Unset):
            type_ = UNSET
        else:
            type_ = UpdateTriggerRequestType(_type_)




        agent_id = d.pop("agentId", UNSET)

        environment_id = d.pop("environmentId", UNSET)

        _runtime = d.pop("runtime", UNSET)
        runtime: Runtime | Unset
        if isinstance(_runtime,  Unset):
            runtime = UNSET
        else:
            runtime = Runtime(_runtime)




        name = d.pop("name", UNSET)

        prompt_template = d.pop("promptTemplate", UNSET)

        _env = d.pop("env", UNSET)
        env: UpdateTriggerRequestEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = UpdateTriggerRequestEnv.from_dict(_env)




        _env_from = d.pop("envFrom", UNSET)
        env_from: list[EnvFromEntry] | Unset = UNSET
        if _env_from is not UNSET:
            env_from = []
            for env_from_item_data in _env_from:
                env_from_item = EnvFromEntry.from_dict(env_from_item_data)



                env_from.append(env_from_item)


        _volumes = d.pop("volumes", UNSET)
        volumes: list[GitHubRepositoryVolume | MemoryStoreVolume | SecretVolume] | Unset = UNSET
        if _volumes is not UNSET:
            volumes = []
            for volumes_item_data in _volumes:
                def _parse_volumes_item(data: object) -> GitHubRepositoryVolume | MemoryStoreVolume | SecretVolume:
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
                        componentsschemas_volume_type_1 = GitHubRepositoryVolume.from_dict(data)



                        return componentsschemas_volume_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_volume_type_2 = MemoryStoreVolume.from_dict(data)



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


        def _parse_schedule(data: object) -> None | Unset | UpdateTriggerRequestScheduleType0:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                schedule_type_0 = UpdateTriggerRequestScheduleType0.from_dict(data)



                return schedule_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UpdateTriggerRequestScheduleType0, data)

        schedule = _parse_schedule(d.pop("schedule", UNSET))


        enabled = d.pop("enabled", UNSET)

        archived = d.pop("archived", UNSET)

        _next_due_at = d.pop("nextDueAt", UNSET)
        next_due_at: datetime.datetime | Unset
        if isinstance(_next_due_at,  Unset):
            next_due_at = UNSET
        else:
            next_due_at = datetime.datetime.fromisoformat(_next_due_at)




        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateTriggerRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateTriggerRequestMetadata.from_dict(_metadata)




        update_trigger_request = cls(
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
            archived=archived,
            next_due_at=next_due_at,
            metadata=metadata,
        )

        return update_trigger_request

