from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.effective_budget import EffectiveBudget
  from ..models.effective_policy_source import EffectivePolicySource
  from ..models.effective_policy_sources_item import EffectivePolicySourcesItem
  from ..models.policy_decision import PolicyDecision
  from ..models.policy_mcp_policy import PolicyMcpPolicy
  from ..models.sandbox_policy import SandboxPolicy
  from ..models.tool_policy import ToolPolicy





T = TypeVar("T", bound="EffectivePolicy")



@_attrs_define
class EffectivePolicy:
    """ 
        Attributes:
            source (EffectivePolicySource):
            sources (list[EffectivePolicySourcesItem]):
            tool_policy (ToolPolicy):
            mcp_policy (PolicyMcpPolicy):
            sandbox_policy (SandboxPolicy):
            budgets (list[EffectiveBudget]):
            decision (PolicyDecision | Unset):
     """

    source: EffectivePolicySource
    sources: list[EffectivePolicySourcesItem]
    tool_policy: ToolPolicy
    mcp_policy: PolicyMcpPolicy
    sandbox_policy: SandboxPolicy
    budgets: list[EffectiveBudget]
    decision: PolicyDecision | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.effective_budget import EffectiveBudget
        from ..models.effective_policy_source import EffectivePolicySource
        from ..models.effective_policy_sources_item import EffectivePolicySourcesItem
        from ..models.policy_decision import PolicyDecision
        from ..models.policy_mcp_policy import PolicyMcpPolicy
        from ..models.sandbox_policy import SandboxPolicy
        from ..models.tool_policy import ToolPolicy
        source = self.source.to_dict()

        sources = []
        for sources_item_data in self.sources:
            sources_item = sources_item_data.to_dict()
            sources.append(sources_item)



        tool_policy = self.tool_policy.to_dict()

        mcp_policy = self.mcp_policy.to_dict()

        sandbox_policy = self.sandbox_policy.to_dict()

        budgets = []
        for budgets_item_data in self.budgets:
            budgets_item = budgets_item_data.to_dict()
            budgets.append(budgets_item)



        decision: dict[str, Any] | Unset = UNSET
        if not isinstance(self.decision, Unset):
            decision = self.decision.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "source": source,
            "sources": sources,
            "toolPolicy": tool_policy,
            "mcpPolicy": mcp_policy,
            "sandboxPolicy": sandbox_policy,
            "budgets": budgets,
        })
        if decision is not UNSET:
            field_dict["decision"] = decision

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.effective_budget import EffectiveBudget
        from ..models.effective_policy_source import EffectivePolicySource
        from ..models.effective_policy_sources_item import EffectivePolicySourcesItem
        from ..models.policy_decision import PolicyDecision
        from ..models.policy_mcp_policy import PolicyMcpPolicy
        from ..models.sandbox_policy import SandboxPolicy
        from ..models.tool_policy import ToolPolicy
        d = dict(src_dict)
        source = EffectivePolicySource.from_dict(d.pop("source"))




        sources = []
        _sources = d.pop("sources")
        for sources_item_data in (_sources):
            sources_item = EffectivePolicySourcesItem.from_dict(sources_item_data)



            sources.append(sources_item)


        tool_policy = ToolPolicy.from_dict(d.pop("toolPolicy"))




        mcp_policy = PolicyMcpPolicy.from_dict(d.pop("mcpPolicy"))




        sandbox_policy = SandboxPolicy.from_dict(d.pop("sandboxPolicy"))




        budgets = []
        _budgets = d.pop("budgets")
        for budgets_item_data in (_budgets):
            budgets_item = EffectiveBudget.from_dict(budgets_item_data)



            budgets.append(budgets_item)


        _decision = d.pop("decision", UNSET)
        decision: PolicyDecision | Unset
        if isinstance(_decision,  Unset):
            decision = UNSET
        else:
            decision = PolicyDecision.from_dict(_decision)




        effective_policy = cls(
            source=source,
            sources=sources,
            tool_policy=tool_policy,
            mcp_policy=mcp_policy,
            sandbox_policy=sandbox_policy,
            budgets=budgets,
            decision=decision,
        )


        effective_policy.additional_properties = d
        return effective_policy

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
