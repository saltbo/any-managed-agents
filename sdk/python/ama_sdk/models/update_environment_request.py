from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_hosting_mode import EnvironmentHostingMode
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.environment_mcp_policy import EnvironmentMcpPolicy
  from ..models.environment_network_policy import EnvironmentNetworkPolicy
  from ..models.update_environment_request_metadata import UpdateEnvironmentRequestMetadata
  from ..models.update_environment_request_package_manager_policy import UpdateEnvironmentRequestPackageManagerPolicy
  from ..models.update_environment_request_packages_item import UpdateEnvironmentRequestPackagesItem
  from ..models.update_environment_request_resource_limits import UpdateEnvironmentRequestResourceLimits
  from ..models.update_environment_request_runtime_config import UpdateEnvironmentRequestRuntimeConfig
  from ..models.update_environment_request_variables import UpdateEnvironmentRequestVariables





T = TypeVar("T", bound="UpdateEnvironmentRequest")



@_attrs_define
class UpdateEnvironmentRequest:
    """ 
        Attributes:
            name (str | Unset):  Example: Node workspace.
            description (None | str | Unset):  Example: Default Node.js environment..
            packages (list[UpdateEnvironmentRequestPackagesItem] | Unset):  Example: [{'name': 'tsx', 'version': 'latest'}].
            variables (UpdateEnvironmentRequestVariables | Unset):  Example: {'NODE_ENV': {'required': True}}.
            hosting_mode (EnvironmentHostingMode | Unset):  Example: cloud.
            network_policy (EnvironmentNetworkPolicy | Unset):  Example: {'mode': 'restricted', 'allowedHosts':
                ['registry.npmjs.org']}.
            mcp_policy (EnvironmentMcpPolicy | Unset):  Example: {'allowedConnectors': ['github']}.
            package_manager_policy (UpdateEnvironmentRequestPackageManagerPolicy | Unset):  Example: {'allowedRegistries':
                ['registry.npmjs.org']}.
            resource_limits (UpdateEnvironmentRequestResourceLimits | Unset):  Example: {'memoryMb': 512}.
            runtime_config (UpdateEnvironmentRequestRuntimeConfig | Unset):  Example: {'image': 'node:24'}.
            metadata (UpdateEnvironmentRequestMetadata | Unset):  Example: {'owner': 'platform'}.
            archived (bool | Unset): Lifecycle transition: true archives the environment, false unarchives it.
     """

    name: str | Unset = UNSET
    description: None | str | Unset = UNSET
    packages: list[UpdateEnvironmentRequestPackagesItem] | Unset = UNSET
    variables: UpdateEnvironmentRequestVariables | Unset = UNSET
    hosting_mode: EnvironmentHostingMode | Unset = UNSET
    network_policy: EnvironmentNetworkPolicy | Unset = UNSET
    mcp_policy: EnvironmentMcpPolicy | Unset = UNSET
    package_manager_policy: UpdateEnvironmentRequestPackageManagerPolicy | Unset = UNSET
    resource_limits: UpdateEnvironmentRequestResourceLimits | Unset = UNSET
    runtime_config: UpdateEnvironmentRequestRuntimeConfig | Unset = UNSET
    metadata: UpdateEnvironmentRequestMetadata | Unset = UNSET
    archived: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.update_environment_request_metadata import UpdateEnvironmentRequestMetadata
        from ..models.update_environment_request_package_manager_policy import UpdateEnvironmentRequestPackageManagerPolicy
        from ..models.update_environment_request_packages_item import UpdateEnvironmentRequestPackagesItem
        from ..models.update_environment_request_resource_limits import UpdateEnvironmentRequestResourceLimits
        from ..models.update_environment_request_runtime_config import UpdateEnvironmentRequestRuntimeConfig
        from ..models.update_environment_request_variables import UpdateEnvironmentRequestVariables
        name = self.name

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        packages: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.packages, Unset):
            packages = []
            for packages_item_data in self.packages:
                packages_item = packages_item_data.to_dict()
                packages.append(packages_item)



        variables: dict[str, Any] | Unset = UNSET
        if not isinstance(self.variables, Unset):
            variables = self.variables.to_dict()

        hosting_mode: str | Unset = UNSET
        if not isinstance(self.hosting_mode, Unset):
            hosting_mode = self.hosting_mode.value


        network_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.network_policy, Unset):
            network_policy = self.network_policy.to_dict()

        mcp_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.mcp_policy, Unset):
            mcp_policy = self.mcp_policy.to_dict()

        package_manager_policy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.package_manager_policy, Unset):
            package_manager_policy = self.package_manager_policy.to_dict()

        resource_limits: dict[str, Any] | Unset = UNSET
        if not isinstance(self.resource_limits, Unset):
            resource_limits = self.resource_limits.to_dict()

        runtime_config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.runtime_config, Unset):
            runtime_config = self.runtime_config.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        archived = self.archived


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if packages is not UNSET:
            field_dict["packages"] = packages
        if variables is not UNSET:
            field_dict["variables"] = variables
        if hosting_mode is not UNSET:
            field_dict["hostingMode"] = hosting_mode
        if network_policy is not UNSET:
            field_dict["networkPolicy"] = network_policy
        if mcp_policy is not UNSET:
            field_dict["mcpPolicy"] = mcp_policy
        if package_manager_policy is not UNSET:
            field_dict["packageManagerPolicy"] = package_manager_policy
        if resource_limits is not UNSET:
            field_dict["resourceLimits"] = resource_limits
        if runtime_config is not UNSET:
            field_dict["runtimeConfig"] = runtime_config
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        from ..models.update_environment_request_metadata import UpdateEnvironmentRequestMetadata
        from ..models.update_environment_request_package_manager_policy import UpdateEnvironmentRequestPackageManagerPolicy
        from ..models.update_environment_request_packages_item import UpdateEnvironmentRequestPackagesItem
        from ..models.update_environment_request_resource_limits import UpdateEnvironmentRequestResourceLimits
        from ..models.update_environment_request_runtime_config import UpdateEnvironmentRequestRuntimeConfig
        from ..models.update_environment_request_variables import UpdateEnvironmentRequestVariables
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        _packages = d.pop("packages", UNSET)
        packages: list[UpdateEnvironmentRequestPackagesItem] | Unset = UNSET
        if _packages is not UNSET:
            packages = []
            for packages_item_data in _packages:
                packages_item = UpdateEnvironmentRequestPackagesItem.from_dict(packages_item_data)



                packages.append(packages_item)


        _variables = d.pop("variables", UNSET)
        variables: UpdateEnvironmentRequestVariables | Unset
        if isinstance(_variables,  Unset):
            variables = UNSET
        else:
            variables = UpdateEnvironmentRequestVariables.from_dict(_variables)




        _hosting_mode = d.pop("hostingMode", UNSET)
        hosting_mode: EnvironmentHostingMode | Unset
        if isinstance(_hosting_mode,  Unset):
            hosting_mode = UNSET
        else:
            hosting_mode = EnvironmentHostingMode(_hosting_mode)




        _network_policy = d.pop("networkPolicy", UNSET)
        network_policy: EnvironmentNetworkPolicy | Unset
        if isinstance(_network_policy,  Unset):
            network_policy = UNSET
        else:
            network_policy = EnvironmentNetworkPolicy.from_dict(_network_policy)




        _mcp_policy = d.pop("mcpPolicy", UNSET)
        mcp_policy: EnvironmentMcpPolicy | Unset
        if isinstance(_mcp_policy,  Unset):
            mcp_policy = UNSET
        else:
            mcp_policy = EnvironmentMcpPolicy.from_dict(_mcp_policy)




        _package_manager_policy = d.pop("packageManagerPolicy", UNSET)
        package_manager_policy: UpdateEnvironmentRequestPackageManagerPolicy | Unset
        if isinstance(_package_manager_policy,  Unset):
            package_manager_policy = UNSET
        else:
            package_manager_policy = UpdateEnvironmentRequestPackageManagerPolicy.from_dict(_package_manager_policy)




        _resource_limits = d.pop("resourceLimits", UNSET)
        resource_limits: UpdateEnvironmentRequestResourceLimits | Unset
        if isinstance(_resource_limits,  Unset):
            resource_limits = UNSET
        else:
            resource_limits = UpdateEnvironmentRequestResourceLimits.from_dict(_resource_limits)




        _runtime_config = d.pop("runtimeConfig", UNSET)
        runtime_config: UpdateEnvironmentRequestRuntimeConfig | Unset
        if isinstance(_runtime_config,  Unset):
            runtime_config = UNSET
        else:
            runtime_config = UpdateEnvironmentRequestRuntimeConfig.from_dict(_runtime_config)




        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateEnvironmentRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateEnvironmentRequestMetadata.from_dict(_metadata)




        archived = d.pop("archived", UNSET)

        update_environment_request = cls(
            name=name,
            description=description,
            packages=packages,
            variables=variables,
            hosting_mode=hosting_mode,
            network_policy=network_policy,
            mcp_policy=mcp_policy,
            package_manager_policy=package_manager_policy,
            resource_limits=resource_limits,
            runtime_config=runtime_config,
            metadata=metadata,
            archived=archived,
        )

        return update_environment_request

