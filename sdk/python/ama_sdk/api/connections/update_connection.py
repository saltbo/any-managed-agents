from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.connection import Connection
from ...models.error_response import ErrorResponse
from ...models.update_connection_request import UpdateConnectionRequest
from typing import cast



def _get_kwargs(
    connection_id: str,
    *,
    body: UpdateConnectionRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/connections/{connection_id}".format(connection_id=quote(str(connection_id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Connection | ErrorResponse | None:
    if response.status_code == 200:
        response_200 = Connection.from_dict(response.json())



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

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())



        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Connection | ErrorResponse]:
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
    body: UpdateConnectionRequest,

) -> Response[Connection | ErrorResponse]:
    """ Update connection state, credential, or settings

    Args:
        connection_id (str):  Example: conn_abc123.
        body (UpdateConnectionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Connection | ErrorResponse]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    connection_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateConnectionRequest,

) -> Connection | ErrorResponse | None:
    """ Update connection state, credential, or settings

    Args:
        connection_id (str):  Example: conn_abc123.
        body (UpdateConnectionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Connection | ErrorResponse
     """


    return sync_detailed(
        connection_id=connection_id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    connection_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateConnectionRequest,

) -> Response[Connection | ErrorResponse]:
    """ Update connection state, credential, or settings

    Args:
        connection_id (str):  Example: conn_abc123.
        body (UpdateConnectionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Connection | ErrorResponse]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    connection_id: str,
    *,
    client: AuthenticatedClient,
    body: UpdateConnectionRequest,

) -> Connection | ErrorResponse | None:
    """ Update connection state, credential, or settings

    Args:
        connection_id (str):  Example: conn_abc123.
        body (UpdateConnectionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Connection | ErrorResponse
     """


    return (await asyncio_detailed(
        connection_id=connection_id,
client=client,
body=body,

    )).parsed
