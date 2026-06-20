from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.tool_call_list_response import ToolCallListResponse
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    connection_id: str,
    tool_name: str,
    *,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/connections/{connection_id}/tools/{tool_name}/calls".format(connection_id=quote(str(connection_id), safe=""),tool_name=quote(str(tool_name), safe=""),),
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | ToolCallListResponse | None:
    if response.status_code == 200:
        response_200 = ToolCallListResponse.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | ToolCallListResponse]:
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
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ErrorResponse | ToolCallListResponse]:
    """ List tool calls

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | ToolCallListResponse]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,
tool_name=tool_name,
limit=limit,
cursor=cursor,

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
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ErrorResponse | ToolCallListResponse | None:
    """ List tool calls

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | ToolCallListResponse
     """


    return sync_detailed(
        connection_id=connection_id,
tool_name=tool_name,
client=client,
limit=limit,
cursor=cursor,

    ).parsed

async def asyncio_detailed(
    connection_id: str,
    tool_name: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> Response[ErrorResponse | ToolCallListResponse]:
    """ List tool calls

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | ToolCallListResponse]
     """


    kwargs = _get_kwargs(
        connection_id=connection_id,
tool_name=tool_name,
limit=limit,
cursor=cursor,

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
    limit: int | Unset = UNSET,
    cursor: str | Unset = UNSET,

) -> ErrorResponse | ToolCallListResponse | None:
    """ List tool calls

    Args:
        connection_id (str):  Example: conn_abc123.
        tool_name (str):  Example: repo.read.
        limit (int | Unset):
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | ToolCallListResponse
     """


    return (await asyncio_detailed(
        connection_id=connection_id,
tool_name=tool_name,
client=client,
limit=limit,
cursor=cursor,

    )).parsed
