from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_hosting_mode import EnvironmentHostingMode
from typing import cast






T = TypeVar("T", bound="SessionPlacementType0")



@_attrs_define
class SessionPlacementType0:
    """ 
        Attributes:
            hosting_mode (EnvironmentHostingMode):  Example: cloud.
            provider (str):  Example: workers-ai.
            model (None | str):  Example: @cf/moonshotai/kimi-k2.6.
            driver (None | str):  Example: ama-cloud.
            backend (None | str):  Example: ama-cloud.
            protocol (None | str):  Example: ama-runtime-rpc.
     """

    hosting_mode: EnvironmentHostingMode
    provider: str
    model: None | str
    driver: None | str
    backend: None | str
    protocol: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        hosting_mode = self.hosting_mode.value

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
            "provider": provider,
            "model": model,
            "driver": driver,
            "backend": backend,
            "protocol": protocol,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        hosting_mode = EnvironmentHostingMode(d.pop("hostingMode"))




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


        session_placement_type_0 = cls(
            hosting_mode=hosting_mode,
            provider=provider,
            model=model,
            driver=driver,
            backend=backend,
            protocol=protocol,
        )


        session_placement_type_0.additional_properties = d
        return session_placement_type_0

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
