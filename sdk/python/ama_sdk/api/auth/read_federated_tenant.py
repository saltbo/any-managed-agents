from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.error_response import ErrorResponse
from ...models.federated_tenant import FederatedTenant
from typing import cast



def _get_kwargs(
    tenant_id: str,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/auth/federated-tenants/{tenant_id}".format(tenant_id=quote(str(tenant_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ErrorResponse | FederatedTenant | None:
    if response.status_code == 200:
        response_200 = FederatedTenant.from_dict(response.json())



        return response_200

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ErrorResponse | FederatedTenant]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    tenant_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | FederatedTenant]:
    """ Read a federated tenant

    Args:
        tenant_id (str):  Example: ftn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | FederatedTenant]
     """


    kwargs = _get_kwargs(
        tenant_id=tenant_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    tenant_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | FederatedTenant | None:
    """ Read a federated tenant

    Args:
        tenant_id (str):  Example: ftn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | FederatedTenant
     """


    return sync_detailed(
        tenant_id=tenant_id,
client=client,

    ).parsed

async def asyncio_detailed(
    tenant_id: str,
    *,
    client: AuthenticatedClient,

) -> Response[ErrorResponse | FederatedTenant]:
    """ Read a federated tenant

    Args:
        tenant_id (str):  Example: ftn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ErrorResponse | FederatedTenant]
     """


    kwargs = _get_kwargs(
        tenant_id=tenant_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    tenant_id: str,
    *,
    client: AuthenticatedClient,

) -> ErrorResponse | FederatedTenant | None:
    """ Read a federated tenant

    Args:
        tenant_id (str):  Example: ftn_abc123.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ErrorResponse | FederatedTenant
     """


    return (await asyncio_detailed(
        tenant_id=tenant_id,
client=client,

    )).parsed
