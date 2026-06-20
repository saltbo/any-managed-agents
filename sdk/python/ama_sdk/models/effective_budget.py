from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.effective_budget_limit_type import EffectiveBudgetLimitType
from ..models.effective_budget_scope import EffectiveBudgetScope
from ..models.effective_budget_window import EffectiveBudgetWindow
from typing import cast

if TYPE_CHECKING:
  from ..models.effective_budget_metadata import EffectiveBudgetMetadata





T = TypeVar("T", bound="EffectiveBudget")



@_attrs_define
class EffectiveBudget:
    """ 
        Attributes:
            id (str):
            scope (EffectiveBudgetScope):
            provider_id (None | str):
            model_id (None | str):
            limit_type (EffectiveBudgetLimitType):
            limit_value (int):
            window (EffectiveBudgetWindow):
            enabled (bool):
            metadata (EffectiveBudgetMetadata):
     """

    id: str
    scope: EffectiveBudgetScope
    provider_id: None | str
    model_id: None | str
    limit_type: EffectiveBudgetLimitType
    limit_value: int
    window: EffectiveBudgetWindow
    enabled: bool
    metadata: EffectiveBudgetMetadata
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.effective_budget_metadata import EffectiveBudgetMetadata
        id = self.id

        scope = self.scope.value

        provider_id: None | str
        provider_id = self.provider_id

        model_id: None | str
        model_id = self.model_id

        limit_type = self.limit_type.value

        limit_value = self.limit_value

        window = self.window.value

        enabled = self.enabled

        metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "id": id,
            "scope": scope,
            "providerId": provider_id,
            "modelId": model_id,
            "limitType": limit_type,
            "limitValue": limit_value,
            "window": window,
            "enabled": enabled,
            "metadata": metadata,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.effective_budget_metadata import EffectiveBudgetMetadata
        d = dict(src_dict)
        id = d.pop("id")

        scope = EffectiveBudgetScope(d.pop("scope"))




        def _parse_provider_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider_id = _parse_provider_id(d.pop("providerId"))


        def _parse_model_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model_id = _parse_model_id(d.pop("modelId"))


        limit_type = EffectiveBudgetLimitType(d.pop("limitType"))




        limit_value = d.pop("limitValue")

        window = EffectiveBudgetWindow(d.pop("window"))




        enabled = d.pop("enabled")

        metadata = EffectiveBudgetMetadata.from_dict(d.pop("metadata"))




        effective_budget = cls(
            id=id,
            scope=scope,
            provider_id=provider_id,
            model_id=model_id,
            limit_type=limit_type,
            limit_value=limit_value,
            window=window,
            enabled=enabled,
            metadata=metadata,
        )


        effective_budget.additional_properties = d
        return effective_budget

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
