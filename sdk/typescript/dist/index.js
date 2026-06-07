import { operations } from './generated/operations.js';
export { operations };
export class AmaClient {
    #origin;
    #accessToken;
    #projectId;
    constructor(options) {
        this.#origin = options.origin.replace(/\/$/, '');
        this.#accessToken = options.accessToken;
        this.#projectId = options.projectId;
    }
    async request(operationId, options = {}) {
        const operation = operations.find((candidate) => candidate.operationId === operationId);
        if (!operation) {
            throw new Error(`Unknown AMA operation: ${operationId}`);
        }
        const url = new URL(`${this.#origin}${formatPath(operation.path, options.path ?? {})}`);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
        const requestInit = {
            method: operation.method,
            headers: {
                authorization: `Bearer ${this.#accessToken}`,
                ...(this.#projectId ? { 'x-ama-project-id': this.#projectId } : {}),
                ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
            },
        };
        if (options.body !== undefined) {
            requestInit.body = JSON.stringify(options.body);
        }
        const response = await fetch(url, requestInit);
        if (!response.ok) {
            throw new AmaApiError(response.status, await response.text());
        }
        if (response.status === 204) {
            return undefined;
        }
        return (await response.json());
    }
}
export class AmaApiError extends Error {
    status;
    responseText;
    constructor(status, responseText) {
        super(`AMA API request failed with HTTP ${status}`);
        this.status = status;
        this.responseText = responseText;
    }
}
function formatPath(pathTemplate, values) {
    return pathTemplate.replaceAll(/\{([^}]+)\}/g, (_, key) => {
        const value = values[key];
        if (!value) {
            throw new Error(`Missing path parameter: ${key}`);
        }
        return encodeURIComponent(value);
    });
}
