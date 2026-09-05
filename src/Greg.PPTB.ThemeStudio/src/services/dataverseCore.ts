/**
 * Shared building blocks for the `Dataverse*Service` family
 * (`dataverseSolutionService`, `dataverseWebResourceService`,
 * `dataverseAppService`, `dataverseThemeScopeService`). Nothing here talks to
 * `window.dataverseAPI` on its own — it only standardises how the services
 * report and wrap failures.
 */

/** An error raised by any Dataverse call, already carrying a user-readable message. */
export class DataverseOperationError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown
    ) {
        super(message);
        this.name = 'DataverseOperationError';
    }
}

/** Coerces an OData response value (often `unknown`) into a plain string. */
export function asString(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value == null) {
        return '';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    return '';
}

/** Extracts a human-readable message from any thrown value. */
export function describe(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (typeof error === 'object' && error !== null) {
        return JSON.stringify(error);
    }
    return String(error);
}

/**
 * Runs a Dataverse call and rewraps any failure as a `DataverseOperationError`
 * prefixed with `what`, so every service reports errors the same way.
 */
export async function run<T>(
    what: string,
    operation: () => Promise<T>
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        throw new DataverseOperationError(
            `${what} failed: ${describe(error)}`,
            error
        );
    }
}

/** Escapes a value for use inside an OData string literal. */
export function odataLiteral(value: string): string {
    return value.replace(/'/g, "''");
}
