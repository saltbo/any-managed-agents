from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.agent_handoff_candidate_list_response import AgentHandoffCandidateListResponse
from ...models.error_response import ErrorResponse
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    agent_id: str,
    *,
    role: str | Unset = UNSET,
    capability: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["role"] = role

    params["capability"] = capability


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/agents/{agent_id}/handoff-candidates".format(agent_id=quote(str(agent_id), safe=""),),
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> AgentHandoffCandidateListResponse | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = AgentHandoffCandidateListResponse.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())



        return response_401

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())



        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[AgentHandoffCandidateListResponse | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    role: str | Unset = UNSET,
    capability: str | Unset = UNSET,

) -> Response[AgentHandoffCandidateListResponse | ErrorResponse]:
    """ List handoff candidate agents

     Resolves live agents in the same project that match the requested role or capability, or the agent
    handoff policy targets. AMA only resolves candidates; the requesting product decides how a handoff
    affects its own workflow records.

    Args:
        agent_id (str):  Example: agent_abc123.
        role (str | Unset):  Example: worker.
        capability (str | Unset):  Example: implementation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentHandoffCandidateListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        agent_id=agent_id,
role=role,
capability=capability,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    role: str | Unset = UNSET,
    capability: str | Unset = UNSET,

) -> AgentHandoffCandidateListResponse | ErrorResponse | None:
    """ List handoff candidate agents

     Resolves live agents in the same project that match the requested role or capability, or the agent
    handoff policy targets. AMA only resolves candidates; the requesting product decides how a handoff
    affects its own workflow records.

    Args:
        agent_id (str):  Example: agent_abc123.
        role (str | Unset):  Example: worker.
        capability (str | Unset):  Example: implementation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentHandoffCandidateListResponse | ErrorResponse
     """


    return sync_detailed(
        agent_id=agent_id,
client=client,
role=role,
capability=capability,

    ).parsed

async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    role: str | Unset = UNSET,
    capability: str | Unset = UNSET,

) -> Response[AgentHandoffCandidateListResponse | ErrorResponse]:
    """ List handoff candidate agents

     Resolves live agents in the same project that match the requested role or capability, or the agent
    handoff policy targets. AMA only resolves candidates; the requesting product decides how a handoff
    affects its own workflow records.

    Args:
        agent_id (str):  Example: agent_abc123.
        role (str | Unset):  Example: worker.
        capability (str | Unset):  Example: implementation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentHandoffCandidateListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        agent_id=agent_id,
role=role,
capability=capability,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    role: str | Unset = UNSET,
    capability: str | Unset = UNSET,

) -> AgentHandoffCandidateListResponse | ErrorResponse | None:
    """ List handoff candidate agents

     Resolves live agents in the same project that match the requested role or capability, or the agent
    handoff policy targets. AMA only resolves candidates; the requesting product decides how a handoff
    affects its own workflow records.

    Args:
        agent_id (str):  Example: agent_abc123.
        role (str | Unset):  Example: worker.
        capability (str | Unset):  Example: implementation.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentHandoffCandidateListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        agent_id=agent_id,
client=client,
role=role,
capability=capability,

    )).parsed
