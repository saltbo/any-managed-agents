from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.lease_channel_metadata import LeaseChannelMetadata
from typing import cast



def _get_kwargs(
    lease_id: str,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/leases/{lease_id}/channel".format(lease_id=quote(str(lease_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | ErrorResponse | LeaseChannelMetadata | None:
    if response.status_code == 101:
        response_101 = cast(Any, None)
        return response_101

    if response.status_code == 200:
        response_200 = LeaseChannelMetadata.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = ErrorResponse.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())



        return response_401

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())



        return response_403

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())



        return response_404

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

    if response.status_code == 426:
        response_426 = ErrorResponse.from_dict(response.json())



        return response_426

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | ErrorResponse | LeaseChannelMetadata]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    lease_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[Any | ErrorResponse | LeaseChannelMetadata]:
    """ Open a claimed runner session WebSocket channel

    Args:
        lease_id (str):  Example: lease_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse | LeaseChannelMetadata]
     """


    kwargs = _get_kwargs(
        lease_id=lease_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    lease_id: str,
    *,
    client: AuthenticatedClient,

) -> Any | ErrorResponse | LeaseChannelMetadata | None:
    """ Open a claimed runner session WebSocket channel

    Args:
        lease_id (str):  Example: lease_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse | LeaseChannelMetadata
     """


    return sync_detailed(
        lease_id=lease_id,
client=client,

    ).parsed

async def asyncio_detailed(
    lease_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[Any | ErrorResponse | LeaseChannelMetadata]:
    """ Open a claimed runner session WebSocket channel

    Args:
        lease_id (str):  Example: lease_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ErrorResponse | LeaseChannelMetadata]
     """


    kwargs = _get_kwargs(
        lease_id=lease_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    lease_id: str,
    *,
    client: AuthenticatedClient,

) -> Any | ErrorResponse | LeaseChannelMetadata | None:
    """ Open a claimed runner session WebSocket channel

    Args:
        lease_id (str):  Example: lease_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ErrorResponse | LeaseChannelMetadata
     """


    return (await asyncio_detailed(
        lease_id=lease_id,
client=client,

    )).parsed
