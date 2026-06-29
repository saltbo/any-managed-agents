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
  from ..models.environment_mcp_policy import EnvironmentMcpPolicy
  from ..models.environment_network_policy import EnvironmentNetworkPolicy
  from ..models.environment_version_metadata import EnvironmentVersionMetadata
  from ..models.environment_version_package_manager_policy import EnvironmentVersionPackageManagerPolicy
  from ..models.environment_version_packages_item import EnvironmentVersionPackagesItem
  from ..models.environment_version_resource_limits import EnvironmentVersionResourceLimits
  from ..models.environment_version_runtime_config import EnvironmentVersionRuntimeConfig
  from ..models.environment_version_variables import EnvironmentVersionVariables





T = TypeVar("T", bound="EnvironmentVersion")



@_attrs_define
class EnvironmentVersion:
    """ 
        Attributes:
            id (str):  Example: envver_abc123.
            environment_id (str):  Example: env_abc123.
            project_id (str):  Example: project_abc123.
            version (int):  Example: 1.
            packages (list[EnvironmentVersionPackagesItem]):  Example: [{'name': 'tsx'}].
            variables (EnvironmentVersionVariables):  Example: {'NODE_ENV': {'required': True}}.
            hosting_mode (EnvironmentHostingMode):  Example: cloud.
            network_policy (EnvironmentNetworkPolicy):  Example: {'mode': 'restricted', 'allowedHosts':
                ['registry.npmjs.org']}.
            mcp_policy (EnvironmentMcpPolicy):  Example: {'allowedConnectors': ['github']}.
            package_manager_policy (EnvironmentVersionPackageManagerPolicy):  Example: {'allowedRegistries':
                ['registry.npmjs.org']}.
            resource_limits (EnvironmentVersionResourceLimits):  Example: {'memoryMb': 512}.
            runtime_config (EnvironmentVersionRuntimeConfig):  Example: {'image': 'node:24'}.
            metadata (EnvironmentVersionMetadata):  Example: {'owner': 'platform'}.
            created_at (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
     """

    id: str
    environment_id: str
    project_id: str
    version: int
    packages: list[EnvironmentVersionPackagesItem]
    variables: EnvironmentVersionVariables
    hosting_mode: EnvironmentHostingMode
    network_policy: EnvironmentNetworkPolicy
    mcp_policy: EnvironmentMcpPolicy
    package_manager_policy: EnvironmentVersionPackageManagerPolicy
    resource_limits: EnvironmentVersionResourceLimits
    runtime_config: EnvironmentVersionRuntimeConfig
    metadata: EnvironmentVersionMetadata
    created_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.environment_version_metadata import EnvironmentVersionMetadata
        from ..models.environment_version_package_manager_policy import EnvironmentVersionPackageManagerPolicy
        from ..models.environment_version_packages_item import EnvironmentVersionPackagesItem
        from ..models.environment_version_resource_limits import EnvironmentVersionResourceLimits
        from ..models.environment_version_runtime_config import EnvironmentVersionRuntimeConfig
        from ..models.environment_version_variables import EnvironmentVersionVariables
        id = self.id

        environment_id = self.environment_id

        project_id = self.project_id

        version = self.version

        packages = []
        for packages_item_data in self.packages:
            packages_item = packages_item_data.to_dict()
            packages.append(packages_item)



        variables = self.variables.to_dict()

        hosting_mode = self.hosting_mode.value

        network_policy = self.network_policy.to_dict()

        mcp_policy = self.mcp_policy.to_dict()

        package_manager_policy = self.package_manager_policy.to_dict()

        resource_limits = self.resource_limits.to_dict()

        runtime_config = self.runtime_config.to_dict()

        metadata = self.metadata.to_dict()

        created_at = self.created_at.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "environmentId": environment_id,
            "projectId": project_id,
            "version": version,
            "packages": packages,
            "variables": variables,
            "hostingMode": hosting_mode,
            "networkPolicy": network_policy,
            "mcpPolicy": mcp_policy,
            "packageManagerPolicy": package_manager_policy,
            "resourceLimits": resource_limits,
            "runtimeConfig": runtime_config,
            "metadata": metadata,
            "createdAt": created_at,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.environment_version_metadata import EnvironmentVersionMetadata
        from ..models.environment_version_package_manager_policy import EnvironmentVersionPackageManagerPolicy
        from ..models.environment_version_packages_item import EnvironmentVersionPackagesItem
        from ..models.environment_version_resource_limits import EnvironmentVersionResourceLimits
        from ..models.environment_version_runtime_config import EnvironmentVersionRuntimeConfig
        from ..models.environment_version_variables import EnvironmentVersionVariables
        d = dict(src_dict)
        id = d.pop("id")

        environment_id = d.pop("environmentId")

        project_id = d.pop("projectId")

        version = d.pop("version")

        packages = []
        _packages = d.pop("packages")
        for packages_item_data in (_packages):
            packages_item = EnvironmentVersionPackagesItem.from_dict(packages_item_data)



            packages.append(packages_item)


        variables = EnvironmentVersionVariables.from_dict(d.pop("variables"))




        hosting_mode = EnvironmentHostingMode(d.pop("hostingMode"))




        network_policy = EnvironmentNetworkPolicy.from_dict(d.pop("networkPolicy"))




        mcp_policy = EnvironmentMcpPolicy.from_dict(d.pop("mcpPolicy"))




        package_manager_policy = EnvironmentVersionPackageManagerPolicy.from_dict(d.pop("packageManagerPolicy"))




        resource_limits = EnvironmentVersionResourceLimits.from_dict(d.pop("resourceLimits"))




        runtime_config = EnvironmentVersionRuntimeConfig.from_dict(d.pop("runtimeConfig"))




        metadata = EnvironmentVersionMetadata.from_dict(d.pop("metadata"))




        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))




        environment_version = cls(
            id=id,
            environment_id=environment_id,
            project_id=project_id,
            version=version,
            packages=packages,
            variables=variables,
            hosting_mode=hosting_mode,
            network_policy=network_policy,
            mcp_policy=mcp_policy,
            package_manager_policy=package_manager_policy,
            resource_limits=resource_limits,
            runtime_config=runtime_config,
            metadata=metadata,
            created_at=created_at,
        )


        environment_version.additional_properties = d
        return environment_version

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
