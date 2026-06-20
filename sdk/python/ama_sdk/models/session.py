from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.session_state import SessionState
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
  from ..models.resource_ref_type_1 import ResourceRefType1
  from ..models.secret_env_entry import SecretEnvEntry
  from ..models.session_agent_snapshot import SessionAgentSnapshot
  from ..models.session_env import SessionEnv
  from ..models.session_environment_snapshot_type_0 import SessionEnvironmentSnapshotType0
  from ..models.session_metadata import SessionMetadata
  from ..models.session_runtime_metadata import SessionRuntimeMetadata





T = TypeVar("T", bound="Session")



@_attrs_define
class Session:
    """ 
        Attributes:
            id (str):  Example: session_abc123.
            project_id (str):  Example: project_abc123.
            agent_id (str):  Example: agent_abc123.
            agent_version_id (str):  Example: agentver_abc123.
            agent_snapshot (SessionAgentSnapshot):
            environment_id (None | str):  Example: env_abc123.
            environment_version_id (None | str):  Example: envver_abc123.
            environment_snapshot (None | SessionEnvironmentSnapshotType0):
            title (None | str):  Example: Implement billing export.
            resource_refs (list[GitHubRepositoryResourceRef | ResourceRefType1]):  Example: [{'type': 'github_repository',
                'owner': 'saltbo', 'repo': 'any-managed-agents', 'ref': 'main'}].
            env (SessionEnv):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            secret_env (list[SecretEnvEntry]):  Example: [{'name': 'AK_AGENT_KEY', 'credentialRef': {'credentialId':
                'vaultcred_abc123', 'versionId': 'vaultver_abc123'}}].
            runtime_metadata (SessionRuntimeMetadata):
            state (SessionState):  Example: idle.
            state_reason (None | str):
            metadata (SessionMetadata):
            started_at (datetime.datetime | None):
            stopped_at (datetime.datetime | None):
            archived_at (datetime.datetime | None):
            created_at (datetime.datetime):
            updated_at (datetime.datetime):
     """

    id: str
    project_id: str
    agent_id: str
    agent_version_id: str
    agent_snapshot: SessionAgentSnapshot
    environment_id: None | str
    environment_version_id: None | str
    environment_snapshot: None | SessionEnvironmentSnapshotType0
    title: None | str
    resource_refs: list[GitHubRepositoryResourceRef | ResourceRefType1]
    env: SessionEnv
    secret_env: list[SecretEnvEntry]
    runtime_metadata: SessionRuntimeMetadata
    state: SessionState
    state_reason: None | str
    metadata: SessionMetadata
    started_at: datetime.datetime | None
    stopped_at: datetime.datetime | None
    archived_at: datetime.datetime | None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        from ..models.session_agent_snapshot import SessionAgentSnapshot
        from ..models.session_env import SessionEnv
        from ..models.session_environment_snapshot_type_0 import SessionEnvironmentSnapshotType0
        from ..models.session_metadata import SessionMetadata
        from ..models.session_runtime_metadata import SessionRuntimeMetadata
        id = self.id

        project_id = self.project_id

        agent_id = self.agent_id

        agent_version_id = self.agent_version_id

        agent_snapshot = self.agent_snapshot.to_dict()

        environment_id: None | str
        environment_id = self.environment_id

        environment_version_id: None | str
        environment_version_id = self.environment_version_id

        environment_snapshot: dict[str, Any] | None
        if isinstance(self.environment_snapshot, SessionEnvironmentSnapshotType0):
            environment_snapshot = self.environment_snapshot.to_dict()
        else:
            environment_snapshot = self.environment_snapshot

        title: None | str
        title = self.title

        resource_refs = []
        for resource_refs_item_data in self.resource_refs:
            resource_refs_item: dict[str, Any]
            if isinstance(resource_refs_item_data, GitHubRepositoryResourceRef):
                resource_refs_item = resource_refs_item_data.to_dict()
            else:
                resource_refs_item = resource_refs_item_data.to_dict()

            resource_refs.append(resource_refs_item)



        env = self.env.to_dict()

        secret_env = []
        for secret_env_item_data in self.secret_env:
            secret_env_item = secret_env_item_data.to_dict()
            secret_env.append(secret_env_item)



        runtime_metadata = self.runtime_metadata.to_dict()

        state = self.state.value

        state_reason: None | str
        state_reason = self.state_reason

        metadata = self.metadata.to_dict()

        started_at: None | str
        if isinstance(self.started_at, datetime.datetime):
            started_at = self.started_at.isoformat()
        else:
            started_at = self.started_at

        stopped_at: None | str
        if isinstance(self.stopped_at, datetime.datetime):
            stopped_at = self.stopped_at.isoformat()
        else:
            stopped_at = self.stopped_at

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
            "agentId": agent_id,
            "agentVersionId": agent_version_id,
            "agentSnapshot": agent_snapshot,
            "environmentId": environment_id,
            "environmentVersionId": environment_version_id,
            "environmentSnapshot": environment_snapshot,
            "title": title,
            "resourceRefs": resource_refs,
            "env": env,
            "secretEnv": secret_env,
            "runtimeMetadata": runtime_metadata,
            "state": state,
            "stateReason": state_reason,
            "metadata": metadata,
            "startedAt": started_at,
            "stoppedAt": stopped_at,
            "archivedAt": archived_at,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.git_hub_repository_resource_ref import GitHubRepositoryResourceRef
        from ..models.resource_ref_type_1 import ResourceRefType1
        from ..models.secret_env_entry import SecretEnvEntry
        from ..models.session_agent_snapshot import SessionAgentSnapshot
        from ..models.session_env import SessionEnv
        from ..models.session_environment_snapshot_type_0 import SessionEnvironmentSnapshotType0
        from ..models.session_metadata import SessionMetadata
        from ..models.session_runtime_metadata import SessionRuntimeMetadata
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        agent_id = d.pop("agentId")

        agent_version_id = d.pop("agentVersionId")

        agent_snapshot = SessionAgentSnapshot.from_dict(d.pop("agentSnapshot"))




        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        def _parse_environment_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_version_id = _parse_environment_version_id(d.pop("environmentVersionId"))


        def _parse_environment_snapshot(data: object) -> None | SessionEnvironmentSnapshotType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_session_environment_snapshot_type_0 = SessionEnvironmentSnapshotType0.from_dict(data)



                return componentsschemas_session_environment_snapshot_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SessionEnvironmentSnapshotType0, data)

        environment_snapshot = _parse_environment_snapshot(d.pop("environmentSnapshot"))


        def _parse_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        title = _parse_title(d.pop("title"))


        resource_refs = []
        _resource_refs = d.pop("resourceRefs")
        for resource_refs_item_data in (_resource_refs):
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


        env = SessionEnv.from_dict(d.pop("env"))




        secret_env = []
        _secret_env = d.pop("secretEnv")
        for secret_env_item_data in (_secret_env):
            secret_env_item = SecretEnvEntry.from_dict(secret_env_item_data)



            secret_env.append(secret_env_item)


        runtime_metadata = SessionRuntimeMetadata.from_dict(d.pop("runtimeMetadata"))




        state = SessionState(d.pop("state"))




        def _parse_state_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        state_reason = _parse_state_reason(d.pop("stateReason"))


        metadata = SessionMetadata.from_dict(d.pop("metadata"))




        def _parse_started_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_at_type_0 = datetime.datetime.fromisoformat(data)



                return started_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        started_at = _parse_started_at(d.pop("startedAt"))


        def _parse_stopped_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                stopped_at_type_0 = datetime.datetime.fromisoformat(data)



                return stopped_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        stopped_at = _parse_stopped_at(d.pop("stoppedAt"))


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




        session = cls(
            id=id,
            project_id=project_id,
            agent_id=agent_id,
            agent_version_id=agent_version_id,
            agent_snapshot=agent_snapshot,
            environment_id=environment_id,
            environment_version_id=environment_version_id,
            environment_snapshot=environment_snapshot,
            title=title,
            resource_refs=resource_refs,
            env=env,
            secret_env=secret_env,
            runtime_metadata=runtime_metadata,
            state=state,
            state_reason=state_reason,
            metadata=metadata,
            started_at=started_at,
            stopped_at=stopped_at,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
        )


        session.additional_properties = d
        return session

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
