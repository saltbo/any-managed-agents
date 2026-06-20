from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.create_tool_call_request import CreateToolCallRequest
from ...models.error_response import ErrorResponse
from ...models.tool_call import ToolCall
from typing import cast



def _get_kwargs(
    connection_id: str,
    tool_name: str,
    *,
    body: CreateToolCallRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/connections/{connection_id}/tools/{tool_name}/calls".format(connection_id=quote(str(connection_id), safe=""),tool_name=quote(str(tool_name), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | ToolCall | None:
    if response.status_code == 201:
        response_201 = ToolCall.from_dict(response.json())



        return response_201

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | ToolCall]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    connection_id: str,
    tool_name: str,
    *,
    client: AuthenticatedClient,
    body: CreateToolCallRequest,

) -> Response[ErrorResponse | ToolCall]:
    """ Execute a connection tool through the AMA policy boundary

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        body (CreateToolCallRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | ToolCall]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,
tool_name=tool_name,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    connection_id: str,
    tool_name: str,
    *,
    client: AuthenticatedClient,
    body: CreateToolCallRequest,

) -> ErrorResponse | ToolCall | None:
    """ Execute a connection tool through the AMA policy boundary

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        body (CreateToolCallRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | ToolCall
     """


    return sync_detailed(
        connection_id=connection_id,
tool_name=tool_name,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    connection_id: str,
    tool_name: str,
    *,
    client: AuthenticatedClient,
    body: CreateToolCallRequest,

) -> Response[ErrorResponse | ToolCall]:
    """ Execute a connection tool through the AMA policy boundary

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        body (CreateToolCallRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | ToolCall]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,
tool_name=tool_name,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    connection_id: str,
    tool_name: str,
    *,
    client: AuthenticatedClient,
    body: CreateToolCallRequest,

) -> ErrorResponse | ToolCall | None:
    """ Execute a connection tool through the AMA policy boundary

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        body (CreateToolCallRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | ToolCall
     """


    return (await asyncio_detailed(
        connection_id=connection_id,
tool_name=tool_name,
client=client,
body=body,

    )).parsed
