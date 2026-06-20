from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime import Runtime
from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
  from ..models.resource_ref_type_1 import ResourceRefType1
  from ..models.secret_env_entry import SecretEnvEntry
  from ..models.update_trigger_request_env import UpdateTriggerRequestEnv
  from ..models.update_trigger_request_metadata import UpdateTriggerRequestMetadata
  from ..models.update_trigger_request_schedule import UpdateTriggerRequestSchedule





T = TypeVar("T", bound="UpdateTriggerRequest")



@_attrs_define
class UpdateTriggerRequest:
    """ 
        Attributes:
            agent_id (str | Unset):  Example: agent_abc123.
            environment_id (str | Unset):  Example: env_abc123.
            runtime (Runtime | Unset):  Example: codex.
            name (str | Unset):  Example: Daily research heartbeat.
            prompt_template (str | Unset):  Example: Research current Canadian banking bonus offers..
            resource_refs (list[GitHubRepositoryResourceRef | ResourceRefType1] | Unset):  Example: [{'type':
                'github_repository', 'owner': 'openai', 'repo': 'openai'}].
            env (UpdateTriggerRequestEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            secret_env (list[SecretEnvEntry] | Unset):  Example: [{'name': 'AK_AGENT_KEY', 'credentialRef': {'credentialId':
                'vaultcred_abc123'}}].
            schedule (UpdateTriggerRequestSchedule | Unset):
            enabled (bool | Unset):
            archived (bool | Unset):  Example: True.
            next_due_at (datetime.datetime | Unset):  Example: 2026-05-27T12:00:00.000Z.
            metadata (UpdateTriggerRequestMetadata | Unset):  Example: {'owner': 'growth'}.
     """

    agent_id: str | Unset = UNSET
    environment_id: str | Unset = UNSET
    runtime: Runtime | Unset = UNSET
    name: str | Unset = UNSET
    prompt_template: str | Unset = UNSET
    resource_refs: list[GitHubRepositoryResourceRef | ResourceRefType1] | Unset = UNSET
    env: UpdateTriggerRequestEnv | Unset = UNSET
    secret_env: list[SecretEnvEntry] | Unset = UNSET
    schedule: UpdateTriggerRequestSchedule | Unset = UNSET
    enabled: bool | Unset = UNSET
    archived: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET
    metadata: UpdateTriggerRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        from ..models.update_trigger_request_env import UpdateTriggerRequestEnv
        from ..models.update_trigger_request_metadata import UpdateTriggerRequestMetadata
        from ..models.update_trigger_request_schedule import UpdateTriggerRequestSchedule
        agent_id = self.agent_id

        environment_id = self.environment_id

        runtime: str | Unset = UNSET
        if not isinstance(self.runtime, Unset):
            runtime = self.runtime.value


        name = self.name

        prompt_template = self.prompt_template

        resource_refs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.resource_refs, Unset):
            resource_refs = []
            for resource_refs_item_data in self.resource_refs:
                resource_refs_item: dict[str, Any]
                if isinstance(resource_refs_item_data, GitHubRepositoryResourceRef):
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



        schedule: dict[str, Any] | Unset = UNSET
        if not isinstance(self.schedule, Unset):
            schedule = self.schedule.to_dict()

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
        if archived is not UNSET:
            field_dict["archived"] = archived
        if next_due_at is not UNSET:
            field_dict["nextDueAt"] = next_due_at
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        from ..models.update_trigger_request_env import UpdateTriggerRequestEnv
        from ..models.update_trigger_request_metadata import UpdateTriggerRequestMetadata
        from ..models.update_trigger_request_schedule import UpdateTriggerRequestSchedule
        d = dict(src_dict)
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

        _resource_refs = d.pop("resourceRefs", UNSET)
        resource_refs: list[GitHubRepositoryResourceRef | ResourceRefType1] | Unset = UNSET
        if _resource_refs is not UNSET:
            resource_refs = []
            for resource_refs_item_data in _resource_refs:
                def _parse_resource_refs_item(data: object) -> GitHubRepositoryResourceRef | ResourceRefType1:
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_resource_ref_type_0 = GitHubRepositoryResourceRef.from_dict(data)



                        return componentsschemas_resource_ref_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_resource_ref_type_1 = ResourceRefType1.from_dict(data)



                    return componentsschemas_resource_ref_type_1

                resource_refs_item = _parse_resource_refs_item(resource_refs_item_data)

                resource_refs.append(resource_refs_item)


        _env = d.pop("env", UNSET)
        env: UpdateTriggerRequestEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = UpdateTriggerRequestEnv.from_dict(_env)




        _secret_env = d.pop("secretEnv", UNSET)
        secret_env: list[SecretEnvEntry] | Unset = UNSET
        if _secret_env is not UNSET:
            secret_env = []
            for secret_env_item_data in _secret_env:
                secret_env_item = SecretEnvEntry.from_dict(secret_env_item_data)



                secret_env.append(secret_env_item)


        _schedule = d.pop("schedule", UNSET)
        schedule: UpdateTriggerRequestSchedule | Unset
        if isinstance(_schedule,  Unset):
            schedule = UNSET
        else:
            schedule = UpdateTriggerRequestSchedule.from_dict(_schedule)




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
            archived=archived,
            next_due_at=next_due_at,
            metadata=metadata,
        )

        return update_trigger_request

