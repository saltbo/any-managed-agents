from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime import Runtime
from typing import cast

if TYPE_CHECKING:
  from ..models.env_from_entry import EnvFromEntry
  from ..models.git_repository_volume import GitRepositoryVolume
  from ..models.memory_volume import MemoryVolume
  from ..models.secret_volume import SecretVolume
  from ..models.trigger_template_spec_env import TriggerTemplateSpecEnv
  from ..models.volume_mount import VolumeMount





T = TypeVar("T", bound="TriggerTemplateSpec")



@_attrs_define
class TriggerTemplateSpec:
    """ 
        Attributes:
            agent_id (str):  Example: agent_abc123.
            environment_id (None | str):  Example: env_abc123.
            runtime (Runtime):  Example: codex.
            prompt_template (str):  Example: Research current Canadian banking bonus offers..
            env (TriggerTemplateSpecEnv):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            env_from (list[EnvFromEntry]):  Example: [{'type': 'secret', 'name': 'AK_AGENT_KEY', 'secretRef':
                'ama://vaults/vault_abc123/credentials/vaultcred_abc123/versions/vaultver_abc123'}].
            volumes (list[GitRepositoryVolume | MemoryVolume | SecretVolume]):  Example: [{'name': 'project-secrets',
                'type': 'secret', 'secretRef': 'ama://vaults/vault_abc123'}].
            volume_mounts (list[VolumeMount]):  Example: [{'name': 'project-secrets', 'mountPath':
                '/workspace/.ama/secrets/project', 'readOnly': True}].
     """

    agent_id: str
    environment_id: None | str
    runtime: Runtime
    prompt_template: str
    env: TriggerTemplateSpecEnv
    env_from: list[EnvFromEntry]
    volumes: list[GitRepositoryVolume | MemoryVolume | SecretVolume]
    volume_mounts: list[VolumeMount]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.trigger_template_spec_env import TriggerTemplateSpecEnv
        from ..models.volume_mount import VolumeMount
        agent_id = self.agent_id

        environment_id: None | str
        environment_id = self.environment_id

        runtime = self.runtime.value

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




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "agentId": agent_id,
            "environmentId": environment_id,
            "runtime": runtime,
            "promptTemplate": prompt_template,
            "env": env,
            "envFrom": env_from,
            "volumes": volumes,
            "volumeMounts": volume_mounts,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.env_from_entry import EnvFromEntry
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.trigger_template_spec_env import TriggerTemplateSpecEnv
        from ..models.volume_mount import VolumeMount
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        runtime = Runtime(d.pop("runtime"))




        prompt_template = d.pop("promptTemplate")

        env = TriggerTemplateSpecEnv.from_dict(d.pop("env"))




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


        trigger_template_spec = cls(
            agent_id=agent_id,
            environment_id=environment_id,
            runtime=runtime,
            prompt_template=prompt_template,
            env=env,
            env_from=env_from,
            volumes=volumes,
            volume_mounts=volume_mounts,
        )


        trigger_template_spec.additional_properties = d
        return trigger_template_spec

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
