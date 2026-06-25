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
  from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
  from ..models.memory_store_resource_ref import MemoryStoreResourceRef
  from ..models.resource_ref_type_1 import ResourceRefType1
  from ..models.secret_env_entry import SecretEnvEntry





T = TypeVar("T", bound="CreateSessionRequest")



@_attrs_define
class CreateSessionRequest:
    """ 
        Attributes:
            agent_id (str):  Example: agent_abc123.
            runtime (Runtime):  Example: codex.
            environment_id (str | Unset):  Example: env_abc123.
            runtime_config (CreateSessionRequestRuntimeConfig | Unset):  Example: {'sandboxMode': 'workspace-write'}.
            title (str | Unset):  Example: Implement billing export.
            metadata (CreateSessionRequestMetadata | Unset):  Example: {'ticket': 'AMA-123'}.
            resource_refs (list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1] | Unset):  Example:
                [{'type': 'github_repository', 'owner': 'saltbo', 'repo': 'any-managed-agents', 'ref': 'main'}].
            env (CreateSessionRequestEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com', 'AK_AGENT_ID':
                'agent_abc123'}.
            secret_env (list[SecretEnvEntry] | Unset):  Example: [{'name': 'AK_AGENT_KEY', 'credentialRef': {'credentialId':
                'vaultcred_abc123'}}].
            initial_prompt (str | Unset):  Example: Research Canadian banking bonus offers and summarize current
                opportunities..
            provider_access_override (bool | Unset):
     """

    agent_id: str
    runtime: Runtime
    environment_id: str | Unset = UNSET
    runtime_config: CreateSessionRequestRuntimeConfig | Unset = UNSET
    title: str | Unset = UNSET
    metadata: CreateSessionRequestMetadata | Unset = UNSET
    resource_refs: list[GitHubRepositoryResourceRef | MemoryStoreResourceRef | ResourceRefType1] | Unset = UNSET
    env: CreateSessionRequestEnv | Unset = UNSET
    secret_env: list[SecretEnvEntry] | Unset = UNSET
    initial_prompt: str | Unset = UNSET
    provider_access_override: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_session_request_env import CreateSessionRequestEnv
        from ..models.create_session_request_metadata import CreateSessionRequestMetadata
        from ..models.create_session_request_runtime_config import CreateSessionRequestRuntimeConfig
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.memory_store_resource_ref import MemoryStoreResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        agent_id = self.agent_id

        runtime = self.runtime.value

        environment_id = self.environment_id

        runtime_config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.runtime_config, Unset):
            runtime_config = self.runtime_config.to_dict()

        title = self.title

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

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



        initial_prompt = self.initial_prompt

        provider_access_override = self.provider_access_override


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "runtime": runtime,
        })
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if runtime_config is not UNSET:
            field_dict["runtimeConfig"] = runtime_config
        if title is not UNSET:
            field_dict["title"] = title
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if resource_refs is not UNSET:
            field_dict["resourceRefs"] = resource_refs
        if env is not UNSET:
            field_dict["env"] = env
        if secret_env is not UNSET:
            field_dict["secretEnv"] = secret_env
        if initial_prompt is not UNSET:
            field_dict["initialPrompt"] = initial_prompt
        if provider_access_override is not UNSET:
            field_dict["providerAccessOverride"] = provider_access_override

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_session_request_env import CreateSessionRequestEnv
        from ..models.create_session_request_metadata import CreateSessionRequestMetadata
        from ..models.create_session_request_runtime_config import CreateSessionRequestRuntimeConfig
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.memory_store_resource_ref import MemoryStoreResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
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




        title = d.pop("title", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateSessionRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateSessionRequestMetadata.from_dict(_metadata)




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
        env: CreateSessionRequestEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = CreateSessionRequestEnv.from_dict(_env)




        _secret_env = d.pop("secretEnv", UNSET)
        secret_env: list[SecretEnvEntry] | Unset = UNSET
        if _secret_env is not UNSET:
            secret_env = []
            for secret_env_item_data in _secret_env:
                secret_env_item = SecretEnvEntry.from_dict(secret_env_item_data)



                secret_env.append(secret_env_item)


        initial_prompt = d.pop("initialPrompt", UNSET)

        provider_access_override = d.pop("providerAccessOverride", UNSET)

        create_session_request = cls(
            agent_id=agent_id,
            runtime=runtime,
            environment_id=environment_id,
            runtime_config=runtime_config,
            title=title,
            metadata=metadata,
            resource_refs=resource_refs,
            env=env,
            secret_env=secret_env,
            initial_prompt=initial_prompt,
            provider_access_override=provider_access_override,
        )

        return create_session_request

