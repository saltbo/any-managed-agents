from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.connection_tool_list_response import ConnectionToolListResponse
from ...models.error_response import ErrorResponse
from typing import cast



def _get_kwargs(
    connection_id: str,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/connections/{connection_id}/tools".format(connection_id=quote(str(connection_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ConnectionToolListResponse | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = ConnectionToolListResponse.from_dict(response.json())



        return response_200

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())



        return response_401

    if response.status_code == 404:
        response_404 = ErrorResponse.from_dict(response.json())



        return response_404

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

    if response.status_code == 502:
        response_502 = ErrorResponse.from_dict(response.json())



        return response_502

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ConnectionToolListResponse | ErrorResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    connection_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ConnectionToolListResponse | ErrorResponse]:
    """ List connection tools

    Args:
        connection_id (str):  Example: conn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ConnectionToolListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    connection_id: str,
    *,
    client: AuthenticatedClient,

) -> ConnectionToolListResponse | ErrorResponse | None:
    """ List connection tools

    Args:
        connection_id (str):  Example: conn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ConnectionToolListResponse | ErrorResponse
     """


    return sync_detailed(
        connection_id=connection_id,
client=client,

    ).parsed

async def asyncio_detailed(
    connection_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ConnectionToolListResponse | ErrorResponse]:
    """ List connection tools

    Args:
        connection_id (str):  Example: conn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ConnectionToolListResponse | ErrorResponse]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    connection_id: str,
    *,
    client: AuthenticatedClient,

) -> ConnectionToolListResponse | ErrorResponse | None:
    """ List connection tools

    Args:
        connection_id (str):  Example: conn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ConnectionToolListResponse | ErrorResponse
     """


    return (await asyncio_detailed(
        connection_id=connection_id,
client=client,

    )).parsed
