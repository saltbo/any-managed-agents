from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_hosting_mode import EnvironmentHostingMode
from typing import cast

if TYPE_CHECKING:
  from ..models.environment_mcp_policy import EnvironmentMcpPolicy
  from ..models.environment_network_policy import EnvironmentNetworkPolicy
  from ..models.environment_spec_metadata import EnvironmentSpecMetadata
  from ..models.environment_spec_package_manager_policy import EnvironmentSpecPackageManagerPolicy
  from ..models.environment_spec_packages_item import EnvironmentSpecPackagesItem
  from ..models.environment_spec_resource_limits import EnvironmentSpecResourceLimits
  from ..models.environment_spec_runtime_config import EnvironmentSpecRuntimeConfig
  from ..models.environment_spec_variables import EnvironmentSpecVariables





T = TypeVar("T", bound="EnvironmentSpec")



@_attrs_define
class EnvironmentSpec:
    """ 
        Attributes:
            packages (list[EnvironmentSpecPackagesItem]):  Example: [{'name': 'tsx', 'version': 'latest'}].
            variables (EnvironmentSpecVariables):  Example: {'NODE_ENV': {'description': 'Runtime mode'}}.
            hosting_mode (EnvironmentHostingMode):  Example: cloud.
            network_policy (EnvironmentNetworkPolicy):  Example: {'mode': 'restricted', 'allowedHosts':
                ['registry.npmjs.org']}.
            mcp_policy (EnvironmentMcpPolicy):  Example: {'allowedConnectors': ['github']}.
            package_manager_policy (EnvironmentSpecPackageManagerPolicy):  Example: {'allowedRegistries':
                ['registry.npmjs.org']}.
            resource_limits (EnvironmentSpecResourceLimits):  Example: {'memoryMb': 512}.
            runtime_config (EnvironmentSpecRuntimeConfig):  Example: {'image': 'node:24'}.
            metadata (EnvironmentSpecMetadata):  Example: {'owner': 'platform'}.
     """

    packages: list[EnvironmentSpecPackagesItem]
    variables: EnvironmentSpecVariables
    hosting_mode: EnvironmentHostingMode
    network_policy: EnvironmentNetworkPolicy
    mcp_policy: EnvironmentMcpPolicy
    package_manager_policy: EnvironmentSpecPackageManagerPolicy
    resource_limits: EnvironmentSpecResourceLimits
    runtime_config: EnvironmentSpecRuntimeConfig
    metadata: EnvironmentSpecMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.environment_spec_metadata import EnvironmentSpecMetadata
        from ..models.environment_spec_package_manager_policy import EnvironmentSpecPackageManagerPolicy
        from ..models.environment_spec_packages_item import EnvironmentSpecPackagesItem
        from ..models.environment_spec_resource_limits import EnvironmentSpecResourceLimits
        from ..models.environment_spec_runtime_config import EnvironmentSpecRuntimeConfig
        from ..models.environment_spec_variables import EnvironmentSpecVariables
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


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "packages": packages,
            "variables": variables,
            "hostingMode": hosting_mode,
            "networkPolicy": network_policy,
            "mcpPolicy": mcp_policy,
            "packageManagerPolicy": package_manager_policy,
            "resourceLimits": resource_limits,
            "runtimeConfig": runtime_config,
            "metadata": metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.environment_spec_metadata import EnvironmentSpecMetadata
        from ..models.environment_spec_package_manager_policy import EnvironmentSpecPackageManagerPolicy
        from ..models.environment_spec_packages_item import EnvironmentSpecPackagesItem
        from ..models.environment_spec_resource_limits import EnvironmentSpecResourceLimits
        from ..models.environment_spec_runtime_config import EnvironmentSpecRuntimeConfig
        from ..models.environment_spec_variables import EnvironmentSpecVariables
        d = dict(src_dict)
        packages = []
        _packages = d.pop("packages")
        for packages_item_data in (_packages):
            packages_item = EnvironmentSpecPackagesItem.from_dict(packages_item_data)



            packages.append(packages_item)


        variables = EnvironmentSpecVariables.from_dict(d.pop("variables"))




        hosting_mode = EnvironmentHostingMode(d.pop("hostingMode"))




        network_policy = EnvironmentNetworkPolicy.from_dict(d.pop("networkPolicy"))




        mcp_policy = EnvironmentMcpPolicy.from_dict(d.pop("mcpPolicy"))




        package_manager_policy = EnvironmentSpecPackageManagerPolicy.from_dict(d.pop("packageManagerPolicy"))




        resource_limits = EnvironmentSpecResourceLimits.from_dict(d.pop("resourceLimits"))




        runtime_config = EnvironmentSpecRuntimeConfig.from_dict(d.pop("runtimeConfig"))




        metadata = EnvironmentSpecMetadata.from_dict(d.pop("metadata"))




        environment_spec = cls(
            packages=packages,
            variables=variables,
            hosting_mode=hosting_mode,
            network_policy=network_policy,
            mcp_policy=mcp_policy,
            package_manager_policy=package_manager_policy,
            resource_limits=resource_limits,
            runtime_config=runtime_config,
            metadata=metadata,
        )


        environment_spec.additional_properties = d
        return environment_spec

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
