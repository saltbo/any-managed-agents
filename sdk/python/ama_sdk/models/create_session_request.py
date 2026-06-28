from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime import Runtime
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_session_request_env import CreateSessionRequestEnv
  from ..models.create_session_request_metadata import CreateSessionRequestMetadata
  from ..models.create_session_request_runtime_config import CreateSessionRequestRuntimeConfig
  from ..models.env_from_entry import EnvFromEntry
  from ..models.git_hub_repository_volume import GitHubRepositoryVolume
  from ..models.memory_store_volume import MemoryStoreVolume
  from ..models.secret_volume import SecretVolume
  from ..models.volume_mount import VolumeMount





T = TypeVar("T", bound="CreateSessionRequest")



@_attrs_define
class CreateSessionRequest:
    """ 
        Attributes:
            agent_id (str):  Example: agent_abc123.
            runtime (Runtime):  Example: codex.
            environment_id (str | Unset):  Example: env_abc123.
            runtime_config (CreateSessionRequestRuntimeConfig | Unset):  Example: {'sandboxMode': 'workspace-write'}.
            name (str | Unset):  Example: Implement billing export.
            metadata (CreateSessionRequestMetadata | Unset):  Example: {'ticket': 'AMA-123'}.
            env (CreateSessionRequestEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com', 'AK_AGENT_ID':
                'agent_abc123'}.
            env_from (list[EnvFromEntry] | Unset):  Example: [{'type': 'secret', 'name': 'AK_AGENT_KEY', 'secretRef':
                'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123'}].
            volumes (list[GitHubRepositoryVolume | MemoryStoreVolume | SecretVolume] | Unset):
            volume_mounts (list[VolumeMount] | Unset):
            initial_prompt (str | Unset):  Example: Research Canadian banking bonus offers and summarize current
                opportunities..
     """

    agent_id: str
    runtime: Runtime
    environment_id: str | Unset = UNSET
    runtime_config: CreateSessionRequestRuntimeConfig | Unset = UNSET
    name: str | Unset = UNSET
    metadata: CreateSessionRequestMetadata | Unset = UNSET
    env: CreateSessionRequestEnv | Unset = UNSET
    env_from: list[EnvFromEntry] | Unset = UNSET
    volumes: list[GitHubRepositoryVolume | MemoryStoreVolume | SecretVolume] | Unset = UNSET
    volume_mounts: list[VolumeMount] | Unset = UNSET
    initial_prompt: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_session_request_env import CreateSessionRequestEnv
        from ..models.create_session_request_metadata import CreateSessionRequestMetadata
        from ..models.create_session_request_runtime_config import CreateSessionRequestRuntimeConfig
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_hub_repository_volume import GitHubRepositoryVolume
        from ..models.memory_store_volume import MemoryStoreVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
        agent_id = self.agent_id

        runtime = self.runtime.value

        environment_id = self.environment_id

        runtime_config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.runtime_config, Unset):
            runtime_config = self.runtime_config.to_dict()

        name = self.name

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

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



        initial_prompt = self.initial_prompt


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "runtime": runtime,
        })
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if runtime_config is not UNSET:
            field_dict["runtimeConfig"] = runtime_config
        if name is not UNSET:
            field_dict["name"] = name
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if env is not UNSET:
            field_dict["env"] = env
        if env_from is not UNSET:
            field_dict["envFrom"] = env_from
        if volumes is not UNSET:
            field_dict["volumes"] = volumes
        if volume_mounts is not UNSET:
            field_dict["volumeMounts"] = volume_mounts
        if initial_prompt is not UNSET:
            field_dict["initialPrompt"] = initial_prompt

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_session_request_env import CreateSessionRequestEnv
        from ..models.create_session_request_metadata import CreateSessionRequestMetadata
        from ..models.create_session_request_runtime_config import CreateSessionRequestRuntimeConfig
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_hub_repository_volume import GitHubRepositoryVolume
        from ..models.memory_store_volume import MemoryStoreVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        runtime = Runtime(d.pop("runtime"))




        environment_id = d.pop("environmentId", UNSET)

        _runtime_config = d.pop("runtimeConfig", UNSET)
        runtime_config: CreateSessionRequestRuntimeConfig | Unset
        if isinstance(_runtime_config,  Unset):
            runtime_config = UNSET
        else:
            runtime_config = CreateSessionRequestRuntimeConfig.from_dict(_runtime_config)




        name = d.pop("name", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateSessionRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateSessionRequestMetadata.from_dict(_metadata)




        _env = d.pop("env", UNSET)
        env: CreateSessionRequestEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = CreateSessionRequestEnv.from_dict(_env)




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


        initial_prompt = d.pop("initialPrompt", UNSET)

        create_session_request = cls(
            agent_id=agent_id,
            runtime=runtime,
            environment_id=environment_id,
            runtime_config=runtime_config,
            name=name,
            metadata=metadata,
            env=env,
            env_from=env_from,
            volumes=volumes,
            volume_mounts=volume_mounts,
            initial_prompt=initial_prompt,
        )

        return create_session_request

