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
  from ..models.create_environment_request_metadata import CreateEnvironmentRequestMetadata
  from ..models.create_environment_request_package_manager_policy import CreateEnvironmentRequestPackageManagerPolicy
  from ..models.create_environment_request_packages_item import CreateEnvironmentRequestPackagesItem
  from ..models.create_environment_request_resource_limits import CreateEnvironmentRequestResourceLimits
  from ..models.create_environment_request_runtime_config import CreateEnvironmentRequestRuntimeConfig
  from ..models.create_environment_request_variables import CreateEnvironmentRequestVariables
  from ..models.credential_ref import CredentialRef
  from ..models.environment_mcp_policy import EnvironmentMcpPolicy
  from ..models.environment_network_policy import EnvironmentNetworkPolicy





T = TypeVar("T", bound="CreateEnvironmentRequest")



@_attrs_define
class CreateEnvironmentRequest:
    """ 
        Attributes:
            name (str):  Example: Node workspace.
            description (None | str | Unset):  Example: Default Node.js environment..
            packages (list[CreateEnvironmentRequestPackagesItem] | Unset):  Example: [{'name': 'tsx', 'version': 'latest'}].
            variables (CreateEnvironmentRequestVariables | Unset):  Example: {'NODE_ENV': {'required': True}}.
            credential_refs (list[CredentialRef] | Unset):  Example: [{'credentialId': 'vaultcred_abc123', 'versionId':
                'vaultver_abc123'}].
            hosting_mode (EnvironmentHostingMode | Unset):  Example: cloud.
            network_policy (EnvironmentNetworkPolicy | Unset):  Example: {'mode': 'restricted', 'allowedHosts':
                ['registry.npmjs.org']}.
            mcp_policy (EnvironmentMcpPolicy | Unset):  Example: {'allowedConnectors': ['github']}.
            package_manager_policy (CreateEnvironmentRequestPackageManagerPolicy | Unset):  Example: {'allowedRegistries':
                ['registry.npmjs.org']}.
            resource_limits (CreateEnvironmentRequestResourceLimits | Unset):  Example: {'memoryMb': 512}.
            runtime_config (CreateEnvironmentRequestRuntimeConfig | Unset):  Example: {'image': 'node:24'}.
            metadata (CreateEnvironmentRequestMetadata | Unset):  Example: {'owner': 'platform'}.
     """

    name: str
    description: None | str | Unset = UNSET
    packages: list[CreateEnvironmentRequestPackagesItem] | Unset = UNSET
    variables: CreateEnvironmentRequestVariables | Unset = UNSET
    credential_refs: list[CredentialRef] | Unset = UNSET
    hosting_mode: EnvironmentHostingMode | Unset = UNSET
    network_policy: EnvironmentNetworkPolicy | Unset = UNSET
    mcp_policy: EnvironmentMcpPolicy | Unset = UNSET
    package_manager_policy: CreateEnvironmentRequestPackageManagerPolicy | Unset = UNSET
    resource_limits: CreateEnvironmentRequestResourceLimits | Unset = UNSET
    runtime_config: CreateEnvironmentRequestRuntimeConfig | Unset = UNSET
    metadata: CreateEnvironmentRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_environment_request_metadata import CreateEnvironmentRequestMetadata
        from ..models.create_environment_request_package_manager_policy import CreateEnvironmentRequestPackageManagerPolicy
        from ..models.create_environment_request_packages_item import CreateEnvironmentRequestPackagesItem
        from ..models.create_environment_request_resource_limits import CreateEnvironmentRequestResourceLimits
        from ..models.create_environment_request_runtime_config import CreateEnvironmentRequestRuntimeConfig
        from ..models.create_environment_request_variables import CreateEnvironmentRequestVariables
        from ..models.credential_ref import CredentialRef
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
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

        credential_refs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.credential_refs, Unset):
            credential_refs = []
            for credential_refs_item_data in self.credential_refs:
                credential_refs_item = credential_refs_item_data.to_dict()
                credential_refs.append(credential_refs_item)



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


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
        })
        if description is not UNSET:
            field_dict["description"] = description
        if packages is not UNSET:
            field_dict["packages"] = packages
        if variables is not UNSET:
            field_dict["variables"] = variables
        if credential_refs is not UNSET:
            field_dict["credentialRefs"] = credential_refs
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

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_environment_request_metadata import CreateEnvironmentRequestMetadata
        from ..models.create_environment_request_package_manager_policy import CreateEnvironmentRequestPackageManagerPolicy
        from ..models.create_environment_request_packages_item import CreateEnvironmentRequestPackagesItem
        from ..models.create_environment_request_resource_limits import CreateEnvironmentRequestResourceLimits
        from ..models.create_environment_request_runtime_config import CreateEnvironmentRequestRuntimeConfig
        from ..models.create_environment_request_variables import CreateEnvironmentRequestVariables
        from ..models.credential_ref import CredentialRef
        from ..models.environment_mcp_policy import EnvironmentMcpPolicy
        from ..models.environment_network_policy import EnvironmentNetworkPolicy
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        _packages = d.pop("packages", UNSET)
        packages: list[CreateEnvironmentRequestPackagesItem] | Unset = UNSET
        if _packages is not UNSET:
            packages = []
            for packages_item_data in _packages:
                packages_item = CreateEnvironmentRequestPackagesItem.from_dict(packages_item_data)



                packages.append(packages_item)


        _variables = d.pop("variables", UNSET)
        variables: CreateEnvironmentRequestVariables | Unset
        if isinstance(_variables,  Unset):
            variables = UNSET
        else:
            variables = CreateEnvironmentRequestVariables.from_dict(_variables)




        _credential_refs = d.pop("credentialRefs", UNSET)
        credential_refs: list[CredentialRef] | Unset = UNSET
        if _credential_refs is not UNSET:
            credential_refs = []
            for credential_refs_item_data in _credential_refs:
                credential_refs_item = CredentialRef.from_dict(credential_refs_item_data)



                credential_refs.append(credential_refs_item)


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
        package_manager_policy: CreateEnvironmentRequestPackageManagerPolicy | Unset
        if isinstance(_package_manager_policy,  Unset):
            package_manager_policy = UNSET
        else:
            package_manager_policy = CreateEnvironmentRequestPackageManagerPolicy.from_dict(_package_manager_policy)




        _resource_limits = d.pop("resourceLimits", UNSET)
        resource_limits: CreateEnvironmentRequestResourceLimits | Unset
        if isinstance(_resource_limits,  Unset):
            resource_limits = UNSET
        else:
            resource_limits = CreateEnvironmentRequestResourceLimits.from_dict(_resource_limits)




        _runtime_config = d.pop("runtimeConfig", UNSET)
        runtime_config: CreateEnvironmentRequestRuntimeConfig | Unset
        if isinstance(_runtime_config,  Unset):
            runtime_config = UNSET
        else:
            runtime_config = CreateEnvironmentRequestRuntimeConfig.from_dict(_runtime_config)




        _metadata = d.pop("metadata", UNSET)
        metadata: CreateEnvironmentRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateEnvironmentRequestMetadata.from_dict(_metadata)




        create_environment_request = cls(
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
        )

        return create_environment_request

