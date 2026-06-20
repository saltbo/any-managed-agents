from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_hosting_mode import EnvironmentHostingMode
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.credential_ref import CredentialRef
  from ..models.environment_mcp_policy import EnvironmentMcpPolicy
  from ..models.environment_metadata import EnvironmentMetadata
  from ..models.environment_network_policy import EnvironmentNetworkPolicy
  from ..models.environment_package_manager_policy import EnvironmentPackageManagerPolicy
  from ..models.environment_packages_item import EnvironmentPackagesItem
  from ..models.environment_resource_limits import EnvironmentResourceLimits
  from ..models.environment_runtime_config import EnvironmentRuntimeConfig
  from ..models.environment_variables import EnvironmentVariables





T = TypeVar("T", bound="Environment")



@_attrs_define
class Environment:
    """ 
        Attributes:
            id (str):  Example: env_abc123.
            project_id (str):  Example: project_abc123.
            name (str):  Example: Node workspace.
            description (None | str):  Example: Default Node.js environment..
            packages (list[EnvironmentPackagesItem]):  Example: [{'name': 'tsx', 'version': 'latest'}].
            variables (EnvironmentVariables):  Example: {'NODE_ENV': {'description': 'Runtime mode'}}.
            credential_refs (list[CredentialRef]):  Example: [{'credentialId': 'vaultcred_abc123', 'versionId':
                'vaultver_abc123'}].
            hosting_mode (EnvironmentHostingMode):  Example: cloud.
            network_policy (EnvironmentNetworkPolicy):  Example: {'mode': 'restricted', 'allowedHosts':
                ['registry.npmjs.org']}.
            mcp_policy (EnvironmentMcpPolicy):  Example: {'allowedConnectors': ['github']}.
            package_manager_policy (EnvironmentPackageManagerPolicy):  Example: {'allowedRegistries':
                ['registry.npmjs.org']}.
            resource_limits (EnvironmentResourceLimits):  Example: {'memoryMb': 512}.
            runtime_config (EnvironmentRuntimeConfig):  Example: {'image': 'node:24'}.
            metadata (EnvironmentMetadata):  Example: {'owner': 'platform'}.
            archived_at (datetime.datetime | None):
            current_version_id (None | str):  Example: envver_abc123.
            version (int):  Example: 1.
            created_at (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
            updated_at (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
     """

    id: str
    project_id: str
    name: str
    description: None | str
    packages: list[EnvironmentPackagesItem]
    variables: EnvironmentVariables
    credential_refs: list[CredentialRef]
    hosting_mode: EnvironmentHostingMode
    network_policy: EnvironmentNetworkPolicy
    mcp_policy: EnvironmentMcpPolicy
    package_manager_policy: EnvironmentPackageManagerPolicy
    resource_limits: EnvironmentResourceLimits
    runtime_config: EnvironmentRuntimeConfig
    metadata: EnvironmentMetadata
    archived_at: datetime.datetime | None
    current_version_id: None | str
    version: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.credential_ref import CredentialRef
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_metadata import EnvironmentMetadata
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.environment_package_manager_policy import EnvironmentPackageManagerPolicy
        from ..models.environment_packages_item import EnvironmentPackagesItem
        from ..models.environment_resource_limits import EnvironmentResourceLimits
        from ..models.environment_runtime_config import EnvironmentRuntimeConfig
        from ..models.environment_variables import EnvironmentVariables
        id = self.id

        project_id = self.project_id

        name = self.name

        description: None | str
        description = self.description

        packages = []
        for packages_item_data in self.packages:
            packages_item = packages_item_data.to_dict()
            packages.append(packages_item)



        variables = self.variables.to_dict()

        credential_refs = []
        for credential_refs_item_data in self.credential_refs:
            credential_refs_item = credential_refs_item_data.to_dict()
            credential_refs.append(credential_refs_item)



        hosting_mode = self.hosting_mode.value

        network_policy = self.network_policy.to_dict()

        mcp_policy = self.mcp_policy.to_dict()

        package_manager_policy = self.package_manager_policy.to_dict()

        resource_limits = self.resource_limits.to_dict()

        runtime_config = self.runtime_config.to_dict()

        metadata = self.metadata.to_dict()

        archived_at: None | str
        if isinstance(self.archived_at, datetime.datetime):
            archived_at = self.archived_at.isoformat()
        else:
            archived_at = self.archived_at

        current_version_id: None | str
        current_version_id = self.current_version_id

        version = self.version

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "projectId": project_id,
            "name": name,
            "description": description,
            "packages": packages,
            "variables": variables,
            "credentialRefs": credential_refs,
            "hostingMode": hosting_mode,
            "networkPolicy": network_policy,
            "mcpPolicy": mcp_policy,
            "packageManagerPolicy": package_manager_policy,
            "resourceLimits": resource_limits,
            "runtimeConfig": runtime_config,
            "metadata": metadata,
            "archivedAt": archived_at,
            "currentVersionId": current_version_id,
            "version": version,
            "createdAt": created_at,
            "updatedAt": updated_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.credential_ref import CredentialRef
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_metadata import EnvironmentMetadata
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.environment_package_manager_policy import EnvironmentPackageManagerPolicy
        from ..models.environment_packages_item import EnvironmentPackagesItem
        from ..models.environment_resource_limits import EnvironmentResourceLimits
        from ..models.environment_runtime_config import EnvironmentRuntimeConfig
        from ..models.environment_variables import EnvironmentVariables
        d = dict(src_dict)
        id = d.pop("id")

        project_id = d.pop("projectId")

        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))


        packages = []
        _packages = d.pop("packages")
        for packages_item_data in (_packages):
            packages_item = EnvironmentPackagesItem.from_dict(packages_item_data)



            packages.append(packages_item)


        variables = EnvironmentVariables.from_dict(d.pop("variables"))




        credential_refs = []
        _credential_refs = d.pop("credentialRefs")
        for credential_refs_item_data in (_credential_refs):
            credential_refs_item = CredentialRef.from_dict(credential_refs_item_data)



            credential_refs.append(credential_refs_item)


        hosting_mode = EnvironmentHostingMode(d.pop("hostingMode"))




        network_policy = EnvironmentNetworkPolicy.from_dict(d.pop("networkPolicy"))




        mcp_policy = EnvironmentMcpPolicy.from_dict(d.pop("mcpPolicy"))




        package_manager_policy = EnvironmentPackageManagerPolicy.from_dict(d.pop("packageManagerPolicy"))




        resource_limits = EnvironmentResourceLimits.from_dict(d.pop("resourceLimits"))




        runtime_config = EnvironmentRuntimeConfig.from_dict(d.pop("runtimeConfig"))




        metadata = EnvironmentMetadata.from_dict(d.pop("metadata"))




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


        def _parse_current_version_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        current_version_id = _parse_current_version_id(d.pop("currentVersionId"))


        version = d.pop("version")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        updated_at = datetime.datetime.fromisoformat(d.pop("updatedAt"))




        environment = cls(
            id=id,
            project_id=project_id,
            name=name,
            description=description,
            packages=packages,
            variables=variables,
            credential_refs=credential_refs,
            hosting_mode=hosting_mode,
            network_policy=network_policy,
            mcp_policy=mcp_policy,
            package_manager_policy=package_manager_policy,
            resource_limits=resource_limits,
            runtime_config=runtime_config,
            metadata=metadata,
            archived_at=archived_at,
            current_version_id=current_version_id,
            version=version,
            created_at=created_at,
            updated_at=updated_at,
        )


        environment.additional_properties = d
        return environment

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
