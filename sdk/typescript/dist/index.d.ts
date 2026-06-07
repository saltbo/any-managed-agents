import { operations, type AmaOperationId } from './generated/operations.js';
export { operations, type AmaOperationId };
export type AmaClientOptions = {
    origin: string;
    accessToken: string;
    projectId?: string;
};
export type AmaRequestOptions = {
    path?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
};
export declare class AmaClient {
    #private;
    constructor(options: AmaClientOptions);
    request<T>(operationId: AmaOperationId, options?: AmaRequestOptions): Promise<T>;
}
export declare class AmaApiError extends Error {
    readonly status: number;
    readonly responseText: string;
    constructor(status: number, responseText: string);
}
