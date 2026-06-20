from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.policy import Policy
from ...models.replace_policy_request import ReplacePolicyRequest
from typing import cast



def _get_kwargs(
    policy_id: str,
    *,
    body: ReplacePolicyRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/policies/{policy_id}".format(policy_id=quote(str(policy_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | Policy | None:
    if response.status_code == 200:
        response_200 = Policy.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | Policy]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    policy_id: str,
    *,
    client: AuthenticatedClient,
    body: ReplacePolicyRequest,

) -> Response[ErrorResponse | Policy]:
    """ Replace a governance policy

    Args:
        policy_id (str):  Example: policy_abc123.
        body (ReplacePolicyRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Policy]
     """


    kwargs = _get_kwargs(
        policy_id=policy_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    policy_id: str,
    *,
    client: AuthenticatedClient,
    body: ReplacePolicyRequest,

) -> ErrorResponse | Policy | None:
    """ Replace a governance policy

    Args:
        policy_id (str):  Example: policy_abc123.
        body (ReplacePolicyRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Policy
     """


    return sync_detailed(
        policy_id=policy_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    policy_id: str,
    *,
    client: AuthenticatedClient,
    body: ReplacePolicyRequest,

) -> Response[ErrorResponse | Policy]:
    """ Replace a governance policy

    Args:
        policy_id (str):  Example: policy_abc123.
        body (ReplacePolicyRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | Policy]
     """


    kwargs = _get_kwargs(
        policy_id=policy_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    policy_id: str,
    *,
    client: AuthenticatedClient,
    body: ReplacePolicyRequest,

) -> ErrorResponse | Policy | None:
    """ Replace a governance policy

    Args:
        policy_id (str):  Example: policy_abc123.
        body (ReplacePolicyRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | Policy
     """


    return (await asyncio_detailed(
        policy_id=policy_id,
client=client,
body=body,

    )).parsed
