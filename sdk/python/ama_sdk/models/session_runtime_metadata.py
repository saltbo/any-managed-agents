from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_hosting_mode import EnvironmentHostingMode
from ..models.runtime import Runtime
from typing import cast

if TYPE_CHECKING:
  from ..models.session_runtime_metadata_runtime_config import SessionRuntimeMetadataRuntimeConfig





T = TypeVar("T", bound="SessionRuntimeMetadata")



@_attrs_define
class SessionRuntimeMetadata:
    """ 
        Attributes:
            hosting_mode (EnvironmentHostingMode):  Example: cloud.
            runtime (Runtime):  Example: codex.
            runtime_config (SessionRuntimeMetadataRuntimeConfig):
            provider (str):  Example: workers-ai.
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
            driver (None | str):  Example: ama-cloud.
            backend (None | str):  Example: ama-cloud.
            protocol (None | str):  Example: ama-runtime-rpc.
     """

    hosting_mode: EnvironmentHostingMode
    runtime: Runtime
    runtime_config: SessionRuntimeMetadataRuntimeConfig
    provider: str
    model: None | str
    driver: None | str
    backend: None | str
    protocol: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_runtime_metadata_runtime_config import SessionRuntimeMetadataRuntimeConfig
        hosting_mode = self.hosting_mode.value

        runtime = self.runtime.value

        runtime_config = self.runtime_config.to_dict()

        provider = self.provider

        model: None | str
        model = self.model

        driver: None | str
        driver = self.driver

        backend: None | str
        backend = self.backend

        protocol: None | str
        protocol = self.protocol


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "hostingMode": hosting_mode,
            "runtime": runtime,
            "runtimeConfig": runtime_config,
            "provider": provider,
            "model": model,
            "driver": driver,
            "backend": backend,
            "protocol": protocol,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_runtime_metadata_runtime_config import SessionRuntimeMetadataRuntimeConfig
        d = dict(src_dict)
        hosting_mode = EnvironmentHostingMode(d.pop("hostingMode"))




        runtime = Runtime(d.pop("runtime"))




        runtime_config = SessionRuntimeMetadataRuntimeConfig.from_dict(d.pop("runtimeConfig"))




        provider = d.pop("provider")

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))


        def _parse_driver(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        driver = _parse_driver(d.pop("driver"))


        def _parse_backend(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        backend = _parse_backend(d.pop("backend"))


        def _parse_protocol(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        protocol = _parse_protocol(d.pop("protocol"))


        session_runtime_metadata = cls(
            hosting_mode=hosting_mode,
            runtime=runtime,
            runtime_config=runtime_config,
            provider=provider,
            model=model,
            driver=driver,
            backend=backend,
            protocol=protocol,
        )


        session_runtime_metadata.additional_properties = d
        return session_runtime_metadata

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
