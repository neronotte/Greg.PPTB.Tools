/**
 * A tiny IndexedDB-backed stand-in for the Dataverse Web API, so Storybook
 * stories can create/update records and see them again after a reload.
 *
 * It supports only the shapes this tool actually sends: a subset of OData
 * (`$select`, `$filter`, `$orderby`, `$top`), simple FetchXML conditions, and
 * the handful of actions the services call.
 */

const DB_NAME = 'theme-studio-storybook';
const DB_VERSION = 2;
const SEED_STORE = 'seedmeta';

interface EntityInfo {
    entitySet: string;
    idColumn: string;
}

const ENTITIES: Record<string, EntityInfo> = {
    solution: { entitySet: 'solutions', idColumn: 'solutionid' },
    appmodule: { entitySet: 'appmodules', idColumn: 'appmoduleid' },
    settingdefinition: {
        entitySet: 'settingdefinitions',
        idColumn: 'settingdefinitionid',
    },
    webresource: { entitySet: 'webresourceset', idColumn: 'webresourceid' },
    organizationsetting: {
        entitySet: 'organizationsettings',
        idColumn: 'organizationsettingid',
    },
    appsetting: { entitySet: 'appsettings', idColumn: 'appsettingid' },
    solutioncomponent: {
        entitySet: 'solutioncomponents',
        idColumn: 'solutioncomponentid',
    },
};

/** ManyToOne relationships the scope service resolves at runtime. */
const RELATIONSHIPS: Record<string, Record<string, string>> = {
    organizationsetting: { settingdefinition: 'settingdefinitionid' },
    appsetting: {
        settingdefinition: 'settingdefinitionid',
        appmodule: 'parentappmoduleid',
    },
};

type Row = Record<string, unknown>;

/** Scalar-only stringification: nested `$expand` objects have no textual value here. */
function text(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}

function entityBySet(entitySet: string): [string, EntityInfo] {
    const match = Object.entries(ENTITIES).find(
        ([, info]) => info.entitySet === entitySet
    );
    if (!match) {
        throw new Error(`Unknown entity set "${entitySet}" in the fake store.`);
    }
    return match;
}

function entityByName(logicalName: string): EntityInfo {
    const info = ENTITIES[logicalName];
    if (!info) {
        throw new Error(`Unknown entity "${logicalName}" in the fake store.`);
    }
    return info;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const open = indexedDB.open(DB_NAME, DB_VERSION);
            open.onupgradeneeded = () => {
                const db = open.result;
                for (const info of Object.values(ENTITIES)) {
                    if (!db.objectStoreNames.contains(info.entitySet)) {
                        db.createObjectStore(info.entitySet, {
                            keyPath: info.idColumn,
                        });
                    }
                }
                if (!db.objectStoreNames.contains(SEED_STORE)) {
                    db.createObjectStore(SEED_STORE, { keyPath: 'entity' });
                }
            };
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
        });
    }
    return dbPromise;
}

async function readAll(entitySet: string): Promise<Row[]> {
    const db = await openDb();
    const store = db
        .transaction(entitySet, 'readonly')
        .objectStore(entitySet) as IDBObjectStore;
    return (await request(store.getAll())) as Row[];
}

async function readOne(
    entitySet: string,
    id: string
): Promise<Row | undefined> {
    const db = await openDb();
    const store = db.transaction(entitySet, 'readonly').objectStore(entitySet);
    return (await request(store.get(id))) as Row | undefined;
}

async function writeRows(entitySet: string, rows: Row[]): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(entitySet, 'readwrite');
    const store = tx.objectStore(entitySet);
    for (const row of rows) {
        store.put(row);
    }
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** Cheap content hash, used to detect edits to the mock JSON files. */
function hash(text: string): string {
    let value = 0;
    for (let i = 0; i < text.length; i++) {
        value = (Math.imul(31, value) + text.charCodeAt(i)) | 0;
    }
    return value.toString(36);
}

async function clearStore(entitySet: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(entitySet, 'readwrite');
    tx.objectStore(entitySet).clear();
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** Seeds each entity once, and reseeds it whenever its mock data changes. */
export async function seedFakeDataverse(
    seeds: Partial<Record<string, Row[]>>
): Promise<void> {
    for (const [logicalName, rows] of Object.entries(seeds)) {
        if (!rows?.length) {
            continue;
        }
        const { entitySet } = entityByName(logicalName);
        const signature = hash(JSON.stringify(rows));
        const previous = (await readOne(SEED_STORE, logicalName)) as
            | { signature?: string }
            | undefined;
        if (previous?.signature === signature) {
            continue;
        }
        await clearStore(entitySet);
        await writeRows(entitySet, rows);
        await writeRows(SEED_STORE, [{ entity: logicalName, signature }]);
    }
}

/** Drops the fake database; handy from the browser console while developing. */
export async function resetFakeDataverse(): Promise<void> {
    const db = await openDb();
    db.close();
    dbPromise = undefined;
    await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        // Another Storybook tab still holds the database open.
        req.onblocked = () => resolve();
    });
}

// --- OData-ish query support -------------------------------------------------

type Predicate = (row: Row) => boolean;

/** Splits on a top-level operator, ignoring parentheses and quoted text. */
function splitTopLevel(expression: string, operator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    for (let i = 0; i < expression.length; i++) {
        const char = expression[i];
        if (char === "'") {
            quoted = !quoted;
        } else if (!quoted && char === '(') {
            depth++;
        } else if (!quoted && char === ')') {
            depth--;
        } else if (
            !quoted &&
            depth === 0 &&
            expression.startsWith(operator, i) &&
            i > 0
        ) {
            parts.push(expression.slice(start, i));
            i += operator.length - 1;
            start = i + 1;
        }
    }
    parts.push(expression.slice(start));
    return parts.map((part) => part.trim());
}

function isWrapped(expression: string): boolean {
    if (!expression.startsWith('(') || !expression.endsWith(')')) {
        return false;
    }
    let depth = 0;
    for (let i = 0; i < expression.length; i++) {
        if (expression[i] === '(') {
            depth++;
        } else if (expression[i] === ')') {
            depth--;
            if (depth === 0) {
                return i === expression.length - 1;
            }
        }
    }
    return false;
}

function literal(raw: string): unknown {
    const value = raw.trim();
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    if (value === 'true' || value === 'false') {
        return value === 'true';
    }
    if (value === 'null') {
        return null;
    }
    const asNumber = Number(value);
    return Number.isNaN(asNumber) ? value : asNumber;
}

function sameValue(left: unknown, right: unknown): boolean {
    if (typeof left === 'string' && typeof right === 'string') {
        return left.toLowerCase() === right.toLowerCase();
    }
    // Guids arrive unquoted, so a raw guid literal is parsed as a string above.
    return left === right;
}

function parseFilter(expression: string): Predicate {
    const trimmed = expression.trim();
    if (!trimmed) {
        return () => true;
    }
    if (isWrapped(trimmed)) {
        return parseFilter(trimmed.slice(1, -1));
    }

    const orParts = splitTopLevel(trimmed, ' or ');
    if (orParts.length > 1) {
        const predicates = orParts.map(parseFilter);
        return (row) => predicates.some((predicate) => predicate(row));
    }

    const andParts = splitTopLevel(trimmed, ' and ');
    if (andParts.length > 1) {
        const predicates = andParts.map(parseFilter);
        return (row) => predicates.every((predicate) => predicate(row));
    }

    const contains = /^contains\(([^,]+),(.+)\)$/.exec(trimmed);
    if (contains) {
        const column = contains[1].trim();
        const term = String(literal(contains[2])).toLowerCase();
        return (row) => text(row[column]).toLowerCase().includes(term);
    }

    const comparison = /^(\S+)\s+(eq|ne|gt|lt|ge|le)\s+(.+)$/.exec(trimmed);
    if (comparison) {
        const [, column, operator, rawValue] = comparison;
        const value = literal(rawValue);
        return (row) => {
            const actual = row[column] ?? null;
            switch (operator) {
                case 'eq':
                    return sameValue(actual, value);
                case 'ne':
                    return !sameValue(actual, value);
                case 'gt':
                    return Number(actual) > Number(value);
                case 'lt':
                    return Number(actual) < Number(value);
                case 'ge':
                    return Number(actual) >= Number(value);
                default:
                    return Number(actual) <= Number(value);
            }
        };
    }

    // Anything unrecognised is treated as "no filter" rather than failing the story.
    return () => true;
}

function queryOption(query: string, option: string): string | undefined {
    const match = new RegExp(`[?&]\\$${option}=([^&]*)`).exec(query);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export async function queryData(query: string): Promise<{ value: Row[] }> {
    const entitySet = query.split('?')[0].split('(')[0];
    const [, info] = entityBySet(entitySet);
    let rows = await readAll(info.entitySet);

    const filter = queryOption(query, 'filter');
    if (filter) {
        rows = rows.filter(parseFilter(filter));
    }

    const orderBy = queryOption(query, 'orderby');
    if (orderBy) {
        const [column, direction] = orderBy.trim().split(/\s+/);
        const sign = direction === 'desc' ? -1 : 1;
        rows = [...rows].sort(
            (a, b) => sign * text(a[column]).localeCompare(text(b[column]))
        );
    }

    const top = Number(queryOption(query, 'top') ?? 0);
    return { value: top > 0 ? rows.slice(0, top) : rows };
}

export async function retrieve(
    logicalName: string,
    id: string
): Promise<Row> {
    const info = entityByName(logicalName);
    const row = await readOne(info.entitySet, id);
    if (!row) {
        throw new Error(`${logicalName} ${id} was not found.`);
    }
    return row;
}

/** Turns `nav@odata.bind: "/entities(guid)"` into the `_nav_value` column reads use. */
function normalizePayload(payload: Row): Row {
    const row: Row = {};
    for (const [key, value] of Object.entries(payload)) {
        const bind = /^(.+)@odata\.bind$/.exec(key);
        if (bind) {
            const guid = /\(([^)]+)\)/.exec(String(value))?.[1] ?? '';
            row[`_${bind[1]}_value`] = guid;
        } else {
            row[key] = value;
        }
    }
    return row;
}

export async function create(
    logicalName: string,
    payload: Row
): Promise<{ id: string }> {
    const info = entityByName(logicalName);
    const id = crypto.randomUUID();
    await writeRows(info.entitySet, [
        {
            ...normalizePayload(payload),
            [info.idColumn]: id,
            modifiedon: new Date().toISOString(),
        },
    ]);
    return { id };
}

export async function update(
    logicalName: string,
    id: string,
    payload: Row
): Promise<void> {
    const info = entityByName(logicalName);
    const existing = await readOne(info.entitySet, id);
    if (!existing) {
        throw new Error(`${logicalName} ${id} was not found.`);
    }
    await writeRows(info.entitySet, [
        {
            ...existing,
            ...normalizePayload(payload),
            [info.idColumn]: id,
            modifiedon: new Date().toISOString(),
        },
    ]);
}

export async function fetchXmlQuery(
    fetchXml: string
): Promise<{ value: Row[] }> {
    const logicalName = /<entity\s+name="([^"]+)"/.exec(fetchXml)?.[1];
    if (!logicalName) {
        return { value: [] };
    }
    const info = entityByName(logicalName);
    let rows = await readAll(info.entitySet);

    const conditions = [
        ...fetchXml.matchAll(
            /<condition\s+attribute="([^"]+)"\s+operator="eq"\s+value="([^"]*)"/g
        ),
    ].map(([, attribute, value]) => ({ attribute, value }));

    if (conditions.length > 0) {
        const isOr = /<filter\s+type="or"/.test(fetchXml);
        const matches = (row: Row, attribute: string, value: string) =>
            sameValue(
                text(row[`_${attribute}_value`] ?? row[attribute]),
                value
            );
        rows = rows.filter((row) =>
            isOr
                ? conditions.some((c) => matches(row, c.attribute, c.value))
                : conditions.every((c) => matches(row, c.attribute, c.value))
        );
    }

    const top = Number(/<fetch[^>]*\stop="(\d+)"/.exec(fetchXml)?.[1] ?? 0);
    return { value: top > 0 ? rows.slice(0, top) : rows };
}

export async function execute(request_: {
    operationName: string;
    parameters?: Row;
}): Promise<Row> {
    if (request_.operationName === 'AddSolutionComponent') {
        const parameters = request_.parameters ?? {};
        await create('solutioncomponent', {
            objectid: parameters.ComponentId,
            componenttype: parameters.ComponentType,
            solutionuniquename: parameters.SolutionUniqueName,
        });
    }
    return {};
}

export async function getEntityRelatedMetadata(
    logicalName: string,
    relationshipType: string
): Promise<{ value: Row[] }> {
    if (relationshipType !== 'ManyToOneRelationships') {
        return { value: [] };
    }
    const relationships = RELATIONSHIPS[logicalName] ?? {};
    return {
        value: Object.entries(relationships).map(
            ([referencedEntity, attribute]) => ({
                ReferencedEntity: referencedEntity,
                ReferencingAttribute: attribute,
                ReferencingEntityNavigationPropertyName: attribute,
            })
        ),
    };
}
