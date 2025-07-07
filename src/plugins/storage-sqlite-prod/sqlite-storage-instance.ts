import {
    RxJsonSchema,
    RxStorageInstanceCreationParams,
    RxStorageInstance,
    getPrimaryFieldOfPrimaryKey,
    EventBulk,
    RxStorageChangeEvent,
    RxDocumentData,
    BulkWriteRow,
    RxStorageBulkWriteResponse,
    RxStorageQueryResult,
    categorizeBulkWriteRows,
    ensureNotFalsy,
    StringKeys,
    addRxStorageMultiInstanceSupport,
    RxStorageDefaultCheckpoint,
    CategorizeBulkWriteRowsOutput,
    RxStorageCountResult,
    promiseWait,
    getQueryMatcher,
    PreparedQuery,
} from '../../index.ts';
import {
    BehaviorSubject,
    Observable,
    Subject,
    filter,
    firstValueFrom,
} from 'rxjs';
import type { RxStorageSQLiteProd } from './index.ts';
import {
    closeDatabaseConnection,
    ensureParamsCountIsCorrect,
    getDatabaseConnection,
    getSQLiteUpdateSQL,
    RX_STORAGE_NAME_SQLITE,
    sqliteTransaction,
    getDataFromResultRow,
    getSQLiteInsertSQL,
    TX_QUEUE_BY_DATABASE,
} from './sqlite-helpers.ts';
import type {
    SQLiteBasics,
    SQLiteInstanceCreationOptions,
    SQLiteInternals,
    SQLiteQueryWithParams,
    SQLiteStorageSettings,
} from './sqlite-types.ts';
import { getSortComparator } from '../../rx-query-helper.ts';
import { newRxError } from '../../rx-error.ts';

let instanceId = 0;
export class RxStorageInstanceSQLite<RxDocType>
    implements
        RxStorageInstance<
            RxDocType,
            SQLiteInternals,
            SQLiteInstanceCreationOptions,
            RxStorageDefaultCheckpoint
        >
{
    public readonly primaryPath: StringKeys<RxDocType>;
    private changes$: Subject<
        EventBulk<
            RxStorageChangeEvent<RxDocumentData<RxDocType>>,
            RxStorageDefaultCheckpoint
        >
    > = new Subject();
    public readonly instanceId = instanceId++;
    public closed?: Promise<void>;

    public sqliteBasics: SQLiteBasics<any>;

    public readonly openWriteCount$ = new BehaviorSubject(0);

    constructor(
        public readonly storage: RxStorageSQLiteProd,
        public readonly databaseName: string,
        public readonly collectionName: string,
        public readonly schema: Readonly<
            RxJsonSchema<RxDocumentData<RxDocType>>
        >,
        public readonly internals: SQLiteInternals,
        public readonly options: Readonly<SQLiteInstanceCreationOptions>,
        public readonly settings: SQLiteStorageSettings,
        public readonly tableName: string,
        public readonly devMode: boolean
    ) {
        this.sqliteBasics = storage.settings.sqliteBasics;
        this.primaryPath = getPrimaryFieldOfPrimaryKey(
            this.schema.primaryKey
        ) as any;
    }

    run(db: any, queryWithParams: SQLiteQueryWithParams) {
        if (this.devMode) {
            ensureParamsCountIsCorrect(queryWithParams);
        }
        return this.sqliteBasics.run(db, queryWithParams);
    }
    all(db: any, queryWithParams: SQLiteQueryWithParams) {
        if (this.devMode) {
            ensureParamsCountIsCorrect(queryWithParams);
        }

        return this.sqliteBasics.all(db, queryWithParams);
    }

    /**
     * Converts RxDB queries to SQL for better performance.
     * Returns fallback info if query is too complex for SQL conversion.
     */
    private convertRxQueryToSQL(
        query: any
    ): { canUseSql: true; sql: string; params: any[] } | { canUseSql: false } {
        try {
            let sqlParts: string[] = [`SELECT data FROM "${this.tableName}"`];
            let whereClauses: string[] = [];
            let params: any[] = [];
            let orderBy: string[] = [];

            const selector = query.selector || {};

            // Let RxDB handle deleted document filtering at the application level
            // Only add deleted filter if the query explicitly requests it

            // Convert selector to SQL WHERE clauses
            const selectorResult = this.convertSelectorToSQL(selector, params);
            if (!selectorResult.canConvert) {
                return { canUseSql: false };
            }
            whereClauses.push(...selectorResult.clauses);

            // Handle sorting
            if (query.sort) {
                const sortResult = this.convertSortToSQL(query.sort);
                if (!sortResult.canConvert) {
                    return { canUseSql: false };
                }
                orderBy.push(...sortResult.clauses);
            }

            // Build the final SQL
            if (whereClauses.length > 0) {
                sqlParts.push(`WHERE ${whereClauses.join(' AND ')}`);
            }

            if (orderBy.length > 0) {
                sqlParts.push(`ORDER BY ${orderBy.join(', ')}`);
            }

            // Handle limit and skip
            if (query.limit !== undefined) {
                sqlParts.push(`LIMIT ?`);
                params.push(query.limit);
            }

            if (query.skip !== undefined && query.skip > 0) {
                sqlParts.push(`OFFSET ?`);
                params.push(query.skip);
            }

            const sql = sqlParts.join(' ');

            return {
                canUseSql: true,
                sql,
                params,
            };
        } catch (error) {
            // If anything goes wrong, fallback to JS
            return { canUseSql: false };
        }
    }

    private convertSelectorToSQL(
        selector: any,
        params: any[]
    ): { canConvert: boolean; clauses: string[] } {
        const clauses: string[] = [];

        for (const [field, value] of Object.entries(selector)) {
            if (field === '_deleted') {
                // Handle deleted field - RxDB uses boolean, SQLite uses integer
                if (
                    typeof value === 'object' &&
                    value !== null &&
                    '$eq' in value
                ) {
                    clauses.push('deleted = ?');
                    params.push((value as any).$eq ? 1 : 0);
                } else {
                    clauses.push('deleted = ?');
                    params.push(value ? 1 : 0);
                }
            } else if (
                field === '_meta' &&
                typeof value === 'object' &&
                value !== null
            ) {
                // Handle _meta.lwt queries
                const metaResult = this.convertMetaFieldToSQL(
                    value as any,
                    params
                );
                if (!metaResult.canConvert) {
                    return { canConvert: false, clauses: [] };
                }
                clauses.push(...metaResult.clauses);
            } else if (field === '$or') {
                // Handle $or queries
                const orResult = this.convertOrToSQL(value as any[], params);
                if (!orResult.canConvert) {
                    return { canConvert: false, clauses: [] };
                }
                clauses.push(orResult.clause);
            } else if (field === '$and') {
                // Handle $and queries
                const andResult = this.convertAndToSQL(value as any[], params);
                if (!andResult.canConvert) {
                    return { canConvert: false, clauses: [] };
                }
                clauses.push(...andResult.clauses);
            } else {
                // Handle regular document fields
                const fieldResult = this.convertFieldToSQL(
                    field,
                    value,
                    params
                );
                if (!fieldResult.canConvert) {
                    return { canConvert: false, clauses: [] };
                }
                clauses.push(fieldResult.clause);
            }
        }

        return { canConvert: true, clauses };
    }

    private convertMetaFieldToSQL(
        metaValue: any,
        params: any[]
    ): { canConvert: boolean; clauses: string[] } {
        const clauses: string[] = [];

        if (metaValue.lwt !== undefined) {
            if (typeof metaValue.lwt === 'object') {
                // Handle operators like $gt, $lt, etc.
                for (const [op, opValue] of Object.entries(metaValue.lwt)) {
                    switch (op) {
                        case '$gt':
                            clauses.push('lastWriteTime > ?');
                            params.push(opValue);
                            break;
                        case '$gte':
                            clauses.push('lastWriteTime >= ?');
                            params.push(opValue);
                            break;
                        case '$lt':
                            clauses.push('lastWriteTime < ?');
                            params.push(opValue);
                            break;
                        case '$lte':
                            clauses.push('lastWriteTime <= ?');
                            params.push(opValue);
                            break;
                        case '$eq':
                            clauses.push('lastWriteTime = ?');
                            params.push(opValue);
                            break;
                        default:
                            return { canConvert: false, clauses: [] };
                    }
                }
            } else {
                clauses.push('lastWriteTime = ?');
                params.push(metaValue.lwt);
            }
        }

        return { canConvert: true, clauses };
    }

    private convertOrToSQL(
        orConditions: any[],
        params: any[]
    ): { canConvert: boolean; clause: string } {
        const orClauses: string[] = [];

        for (const condition of orConditions) {
            // Don't let sub-conditions handle _deleted - we handle it at the top level
            const cleanCondition = { ...condition };
            delete cleanCondition._deleted;

            const conditionResult = this.convertSelectorToSQL(
                cleanCondition,
                params
            );
            if (!conditionResult.canConvert) {
                return { canConvert: false, clause: '' };
            }
            if (conditionResult.clauses.length > 0) {
                orClauses.push(`(${conditionResult.clauses.join(' AND ')})`);
            } else {
                // If a condition produces no clauses, it means "match all"
                // For OR, if any sub-condition matches all, the whole OR matches all
                orClauses.push('1=1');
            }
        }

        if (orClauses.length === 0) {
            return { canConvert: false, clause: '' };
        }

        return { canConvert: true, clause: `(${orClauses.join(' OR ')})` };
    }

    private convertAndToSQL(
        andConditions: any[],
        params: any[]
    ): { canConvert: boolean; clauses: string[] } {
        const andClauses: string[] = [];

        for (const condition of andConditions) {
            const conditionResult = this.convertSelectorToSQL(
                condition,
                params
            );
            if (!conditionResult.canConvert) {
                return { canConvert: false, clauses: [] };
            }
            andClauses.push(...conditionResult.clauses);
        }

        return { canConvert: true, clauses: andClauses };
    }

    private convertFieldToSQL(
        field: string,
        value: any,
        params: any[]
    ): { canConvert: boolean; clause: string } {
        const isPrimaryKey = field === this.primaryPath;
        const jsonPath = isPrimaryKey ? '$.id' : `$.${field}`;

        if (value === null) {
            if (isPrimaryKey) {
                return {
                    canConvert: true,
                    clause: `id IS NULL`,
                };
            } else {
                return {
                    canConvert: true,
                    clause: `json_extract(data, '${jsonPath}') IS NULL`,
                };
            }
        }

        if (typeof value === 'object' && value !== null) {
            // Handle operators
            if (value.hasOwnProperty('$exists')) {
                if (value.$exists === false) {
                    return {
                        canConvert: true,
                        clause: `json_extract(data, '${jsonPath}') IS NULL`,
                    };
                } else if (value.$exists === true) {
                    return {
                        canConvert: true,
                        clause: `json_extract(data, '${jsonPath}') IS NOT NULL`,
                    };
                }
            }

            if (value.hasOwnProperty('$eq')) {
                const sqlValue = this.convertValueForSQL(value.$eq);
                params.push(sqlValue);
                return {
                    canConvert: true,
                    clause: isPrimaryKey
                        ? `id = ?`
                        : `json_extract(data, '${jsonPath}') = ?`,
                };
            }

            if (value.hasOwnProperty('$ne')) {
                const sqlValue = this.convertValueForSQL(value.$ne);
                params.push(sqlValue);
                if (isPrimaryKey) {
                    return {
                        canConvert: true,
                        clause: `id != ?`,
                    };
                } else {
                    // For JSON fields, $ne should also match NULL values (missing fields)
                    // because in MongoDB/RxDB, missing fields are considered different from any value
                    return {
                        canConvert: true,
                        clause: `(json_extract(data, '${jsonPath}') != ? OR json_extract(data, '${jsonPath}') IS NULL)`,
                    };
                }
            }

            if (value.hasOwnProperty('$in')) {
                const inValues = value.$in;
                if (!Array.isArray(inValues) || inValues.length === 0) {
                    return { canConvert: false, clause: '' };
                }
                const placeholders = inValues.map(() => '?').join(',');
                const sqlValues = inValues.map((v) =>
                    this.convertValueForSQL(v)
                );
                params.push(...sqlValues);
                return {
                    canConvert: true,
                    clause: isPrimaryKey
                        ? `id IN (${placeholders})`
                        : `json_extract(data, '${jsonPath}') IN (${placeholders})`,
                };
            }

            if (value.hasOwnProperty('$nin')) {
                const ninValues = value.$nin;
                if (!Array.isArray(ninValues) || ninValues.length === 0) {
                    return { canConvert: false, clause: '' };
                }
                const placeholders = ninValues.map(() => '?').join(',');
                const sqlValues = ninValues.map((v) =>
                    this.convertValueForSQL(v)
                );
                params.push(...sqlValues);
                return {
                    canConvert: true,
                    clause: isPrimaryKey
                        ? `id NOT IN (${placeholders})`
                        : `json_extract(data, '${jsonPath}') NOT IN (${placeholders})`,
                };
            }

            // Comparison operators
            for (const [op, opValue] of Object.entries(value)) {
                switch (op) {
                    case '$gt':
                        params.push(this.convertValueForSQL(opValue));
                        return {
                            canConvert: true,
                            clause: isPrimaryKey
                                ? `id > ?`
                                : this.getJsonComparisonClause(
                                      jsonPath,
                                      '>',
                                      typeof opValue === 'number'
                                  ),
                        };
                    case '$gte':
                        params.push(this.convertValueForSQL(opValue));
                        return {
                            canConvert: true,
                            clause: isPrimaryKey
                                ? `id >= ?`
                                : this.getJsonComparisonClause(
                                      jsonPath,
                                      '>=',
                                      typeof opValue === 'number'
                                  ),
                        };
                    case '$lt':
                        params.push(this.convertValueForSQL(opValue));
                        return {
                            canConvert: true,
                            clause: isPrimaryKey
                                ? `id < ?`
                                : this.getJsonComparisonClause(
                                      jsonPath,
                                      '<',
                                      typeof opValue === 'number'
                                  ),
                        };
                    case '$lte':
                        params.push(this.convertValueForSQL(opValue));
                        return {
                            canConvert: true,
                            clause: isPrimaryKey
                                ? `id <= ?`
                                : this.getJsonComparisonClause(
                                      jsonPath,
                                      '<=',
                                      typeof opValue === 'number'
                                  ),
                        };
                    case '$regex':
                        // SQLite doesn't have native regex, fall back to JS
                        return { canConvert: false, clause: '' };
                    default:
                        // Unsupported operator, fall back to JS
                        return { canConvert: false, clause: '' };
                }
            }

            // Complex object, fall back to JS
            return { canConvert: false, clause: '' };
        }

        // Simple equality
        const sqlValue = this.convertValueForSQL(value);
        params.push(sqlValue);
        return {
            canConvert: true,
            clause: isPrimaryKey
                ? `id = ?`
                : `json_extract(data, '${jsonPath}') = ?`,
        };
    }

    private convertSortToSQL(sort: any[]): {
        canConvert: boolean;
        clauses: string[];
    } {
        const clauses: string[] = [];

        for (const sortItem of sort) {
            const field = Object.keys(sortItem)[0];
            const direction = sortItem[field] === 'desc' ? 'DESC' : 'ASC';

            if (field === '_meta.lwt') {
                clauses.push(`lastWriteTime ${direction}`);
            } else if (field === this.primaryPath) {
                clauses.push(`id ${direction}`);
            } else {
                // Sort by JSON field
                const jsonPath = `$.${field}`;
                clauses.push(`json_extract(data, '${jsonPath}') ${direction}`);
            }
        }

        return { canConvert: true, clauses };
    }

    private convertValueForSQL(value: any): any {
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        return value;
    }

    private getJsonComparisonClause(
        jsonPath: string,
        operator: string,
        isNumeric: boolean
    ): string {
        if (isNumeric) {
            // For numeric comparisons, cast to REAL to ensure proper numeric comparison
            return `CAST(json_extract(data, '${jsonPath}') AS REAL) ${operator} ?`;
        } else {
            // For text comparisons, use regular json_extract
            return `json_extract(data, '${jsonPath}') ${operator} ?`;
        }
    }

    /**
     * @link https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-insertions-971aff98eef2
     */
    async bulkWrite(
        documentWrites: BulkWriteRow<RxDocType>[],
        context: string
    ): Promise<RxStorageBulkWriteResponse<RxDocType>> {
        this.openWriteCount$.next(this.openWriteCount$.getValue() + 1);
        const database = await this.internals.databasePromise;
        const ret: RxStorageBulkWriteResponse<RxDocType> = {
            error: [],
        };
        const writePromises: Promise<any>[] = [];
        let categorized: CategorizeBulkWriteRowsOutput<RxDocType> = {} as any;

        await sqliteTransaction(
            database,
            this.sqliteBasics,
            async () => {
                if (this.closed) {
                    this.openWriteCount$.next(
                        this.openWriteCount$.getValue() - 1
                    );
                    throw new Error(
                        'SQLite.bulkWrite(' +
                            context +
                            ') already closed ' +
                            this.tableName +
                            ' context: ' +
                            context
                    );
                }
                // Extract IDs from the documents being written
                const idsToQuery = documentWrites.map(
                    (row) => row.document[this.primaryPath] as string
                );

                const docsInDb: Map<
                    RxDocumentData<RxDocType>[StringKeys<RxDocType>],
                    RxDocumentData<RxDocType>
                > = new Map();

                // Only query the specific documents we're writing, not everything
                if (idsToQuery.length > 0) {
                    const placeholders = idsToQuery.map(() => '?').join(',');
                    const result = await this.all(database, {
                        query: `SELECT data FROM "${this.tableName}" WHERE id IN (${placeholders})`,
                        params: idsToQuery,
                        context: {
                            method: 'bulkWrite',
                            data: documentWrites,
                        },
                    });

                    result.forEach((docSQLResult) => {
                        const doc = JSON.parse(
                            getDataFromResultRow(docSQLResult)
                        );
                        const id = doc[this.primaryPath];
                        docsInDb.set(id, doc);
                    });
                }
                categorized = categorizeBulkWriteRows(
                    this,
                    this.primaryPath,
                    docsInDb,
                    documentWrites,
                    context
                );
                ret.error = categorized.errors;

                categorized.bulkInsertDocs.forEach((row) => {
                    const insertQuery = getSQLiteInsertSQL(
                        this.tableName,
                        this.primaryPath as any,
                        row.document
                    );
                    writePromises.push(
                        this.all(database, {
                            query: insertQuery.query,
                            params: insertQuery.params,
                            context: {
                                method: 'bulkWrite',
                                data: categorized,
                            },
                        })
                    );
                });

                categorized.bulkUpdateDocs.forEach((row) => {
                    const updateQuery = getSQLiteUpdateSQL<RxDocType>(
                        this.tableName,
                        this.primaryPath,
                        row
                    );
                    writePromises.push(this.run(database, updateQuery));
                });

                await Promise.all(writePromises);

                // close transaction
                if (this.closed) {
                    this.openWriteCount$.next(
                        this.openWriteCount$.getValue() - 1
                    );
                    return 'ROLLBACK';
                } else {
                    this.openWriteCount$.next(
                        this.openWriteCount$.getValue() - 1
                    );
                    return 'COMMIT';
                }
            },
            {
                databaseName: this.databaseName,
                collectionName: this.collectionName,
            }
        );

        if (categorized && categorized.eventBulk.events.length > 0) {
            const lastState = ensureNotFalsy(categorized.newestRow).document;
            categorized.eventBulk.checkpoint = {
                id: lastState[this.primaryPath],
                lwt: lastState._meta.lwt,
            };
            this.changes$.next(categorized.eventBulk);
        }

        return ret;
    }

    async query(
        originalPreparedQuery: PreparedQuery<RxDocType>
    ): Promise<RxStorageQueryResult<RxDocType>> {
        const database = await this.internals.databasePromise;
        const query = originalPreparedQuery.query;

        // Try to convert to SQL query for better performance
        const sqlQuery = this.convertRxQueryToSQL(query);

        if (sqlQuery.canUseSql) {
            // Use optimized SQL query
            if (this.devMode) {
                console.log(
                    `📊 SQL Optimization: Using SQL query for better performance`
                );
                console.log(`   SQL: ${sqlQuery.sql}`);
                console.log(`   Params: ${JSON.stringify(sqlQuery.params)}`);
            }

            const subResult = await this.all(database, {
                query: sqlQuery.sql,
                params: sqlQuery.params,
                context: {
                    method: 'query',
                    data: originalPreparedQuery,
                },
            });

            const result: RxDocumentData<RxDocType>[] = [];
            subResult.forEach((row) => {
                const docData = JSON.parse(getDataFromResultRow(row));
                result.push(docData);
            });

            return {
                documents: result,
            };
        } else {
            // Fallback to in-memory filtering for complex queries
            if (this.devMode) {
                console.log(
                    `🔄 Fallback: Using JavaScript filtering for complex query`
                );
                console.log(`   Query: ${JSON.stringify(query, null, 2)}`);
            }

            const skip = query.skip ? query.skip : 0;
            const limit = query.limit ? query.limit : Infinity;
            const skipPlusLimit = skip + limit;
            const queryMatcher = getQueryMatcher(this.schema, query as any);

            const subResult = await this.all(database, {
                query: 'SELECT data FROM "' + this.tableName + '"',
                params: [],
                context: {
                    method: 'query',
                    data: originalPreparedQuery,
                },
            });

            let result: RxDocumentData<RxDocType>[] = [];
            subResult.forEach((row) => {
                const docData = JSON.parse(getDataFromResultRow(row));
                if (queryMatcher(docData)) {
                    result.push(docData);
                }
            });

            const sortComparator = getSortComparator(this.schema, query as any);
            result = result.sort(sortComparator);
            result = result.slice(skip, skipPlusLimit);

            return {
                documents: result,
            };
        }
    }
    async count(
        originalPreparedQuery: PreparedQuery<RxDocType>
    ): Promise<RxStorageCountResult> {
        const database = await this.internals.databasePromise;
        const query = originalPreparedQuery.query;

        // Try to use SQL COUNT for better performance
        const sqlQuery = this.convertRxQueryToSQL(query);

        if (sqlQuery.canUseSql) {
            // Convert SELECT to COUNT query
            const countSql = sqlQuery.sql.replace(
                `SELECT data FROM "${this.tableName}"`,
                `SELECT COUNT(*) as count FROM "${this.tableName}"`
            );

            // Remove LIMIT and OFFSET for count (they don't affect count)
            const cleanCountSql = countSql
                .replace(/\s+LIMIT\s+\?/gi, '')
                .replace(/\s+OFFSET\s+\?/gi, '');

            // Remove corresponding LIMIT/OFFSET parameters
            let countParams = [...sqlQuery.params];
            if (query.limit !== undefined) {
                countParams.pop(); // Remove limit param
            }
            if (query.skip !== undefined && query.skip > 0) {
                countParams.pop(); // Remove offset param
            }

            if (this.devMode) {
                console.log(`📊 SQL Count: Using optimized COUNT query`);
                console.log(`   SQL: ${cleanCountSql}`);
                console.log(`   Params: ${JSON.stringify(countParams)}`);
            }

            const result = await this.all(database, {
                query: cleanCountSql,
                params: countParams,
                context: {
                    method: 'count',
                    data: originalPreparedQuery,
                },
            });

            // Extract count from the result row
            const countValue = Array.isArray(result[0])
                ? result[0][0]
                : (result[0] as any).count;

            return {
                count: countValue || 0,
                mode: 'fast',
            };
        } else {
            // Fallback to full query and count in memory
            const results = await this.query(originalPreparedQuery);
            return {
                count: results.documents.length,
                mode: 'fast',
            };
        }
    }

    async findDocumentsById(
        ids: string[],
        withDeleted: boolean
    ): Promise<RxDocumentData<RxDocType>[]> {
        const database = await this.internals.databasePromise;

        if (this.closed) {
            throw new Error(
                'SQLite.findDocumentsById() already closed ' +
                    this.tableName +
                    ' context: findDocumentsById'
            );
        }

        if (ids.length === 0) {
            return [];
        }

        // Create placeholders for the IN clause
        const placeholders = ids.map(() => '?').join(',');
        let query = `SELECT data FROM "${this.tableName}" WHERE id IN (${placeholders})`;
        let params = [...ids];

        // Filter out deleted documents unless explicitly requested
        if (!withDeleted) {
            query += ' AND deleted = 0';
        }

        const result = await this.all(database, {
            query,
            params,
            context: {
                method: 'findDocumentsById',
                data: ids,
            },
        });

        const ret: RxDocumentData<RxDocType>[] = [];
        for (let i = 0; i < result.length; ++i) {
            const resultRow = result[i];
            const doc: RxDocumentData<RxDocType> = JSON.parse(
                getDataFromResultRow(resultRow)
            );
            ret.push(doc);
        }
        return ret;
    }

    changeStream(): Observable<
        EventBulk<
            RxStorageChangeEvent<RxDocumentData<RxDocType>>,
            RxStorageDefaultCheckpoint
        >
    > {
        return this.changes$.asObservable();
    }

    async cleanup(minimumDeletedTime: number): Promise<boolean> {
        await promiseWait(0);
        await promiseWait(0);
        const database = await this.internals.databasePromise;

        /**
         * Purge deleted documents
         */
        const minTimestamp = new Date().getTime() - minimumDeletedTime;
        await this.all(database, {
            query: `
                    DELETE FROM
                        "${this.tableName}"
                    WHERE
                        deleted = 1
                        AND
                        lastWriteTime < ?
                `,
            params: [minTimestamp],
            context: {
                method: 'cleanup',
                data: minimumDeletedTime,
            },
        });
        return true;
    }

    async getAttachmentData(
        _documentId: string,
        _attachmentId: string
    ): Promise<string> {
        throw newRxError('SQL1');
    }

    async remove(): Promise<void> {
        if (this.closed) {
            throw new Error('closed already');
        }
        const database = await this.internals.databasePromise;
        const promises = [
            this.run(database, {
                query: `DROP TABLE IF EXISTS "${this.tableName}"`,
                params: [],
                context: {
                    method: 'remove',
                    data: this.tableName,
                },
            }),
        ];
        await Promise.all(promises);
        return this.close();
    }

    async close(): Promise<void> {
        const queue = TX_QUEUE_BY_DATABASE.get(
            await this.internals.databasePromise
        );
        if (queue) {
            await queue;
        }

        if (this.closed) {
            return this.closed;
        }
        this.closed = (async () => {
            await firstValueFrom(
                this.openWriteCount$.pipe(filter((v) => v === 0))
            );
            const database = await this.internals.databasePromise;

            /**
             * First get a transaction
             * to ensure currently running operations
             * are finished
             */
            await sqliteTransaction(database, this.sqliteBasics, () => {
                return Promise.resolve('COMMIT');
            }).catch(() => {});
            this.changes$.complete();
            await closeDatabaseConnection(
                this.databaseName,
                this.storage.settings.sqliteBasics
            );
        })();
        return this.closed;
    }
}

export async function createSQLiteTrialStorageInstance<RxDocType>(
    storage: RxStorageSQLiteProd,
    params: RxStorageInstanceCreationParams<
        RxDocType,
        SQLiteInstanceCreationOptions
    >,
    settings: SQLiteStorageSettings
): Promise<RxStorageInstanceSQLite<RxDocType>> {
    const sqliteBasics = settings.sqliteBasics;
    const tableName = params.collectionName + '-' + params.schema.version;

    if (params.schema.attachments) {
        throw newRxError('SQL1');
    }

    const internals: Partial<SQLiteInternals> = {};
    const useDatabaseName =
        (settings.databaseNamePrefix ? settings.databaseNamePrefix : '') +
        '_prod_' +
        params.databaseName;
    internals.databasePromise = getDatabaseConnection(
        storage.settings.sqliteBasics,
        useDatabaseName
    ).then(async (database) => {
        await sqliteTransaction(
            database,
            sqliteBasics,
            async () => {
                // Create the main table
                const tableQuery = `
                CREATE TABLE IF NOT EXISTS "${tableName}"(
                    id TEXT NOT NULL PRIMARY KEY UNIQUE,
                    revision TEXT,
                    deleted BOOLEAN NOT NULL CHECK (deleted IN (0, 1)),
                    lastWriteTime INTEGER NOT NULL,
                    data json
                );
                `;
                await sqliteBasics.run(database, {
                    query: tableQuery,
                    params: [],
                    context: {
                        method: 'createSQLiteStorageInstance create tables',
                        data: params.databaseName,
                    },
                });

                // Create performance indexes - only on universal RxDB metadata fields
                const indexes = [
                    // Core RxDB metadata indexes that every collection has
                    `CREATE INDEX IF NOT EXISTS "idx_${tableName}_deleted" ON "${tableName}" (deleted);`,
                    `CREATE INDEX IF NOT EXISTS "idx_${tableName}_lwt" ON "${tableName}" (lastWriteTime);`,
                    `CREATE INDEX IF NOT EXISTS "idx_${tableName}_deleted_lwt" ON "${tableName}" (deleted, lastWriteTime);`,

                    // Note: Additional application-specific indexes should be created by the application
                    // using the schema.indexes property in RxDB, not hardcoded in the storage layer.
                    // The SQL query optimization engine will dynamically handle any field names.
                ];

                for (const indexQuery of indexes) {
                    await sqliteBasics.run(database, {
                        query: indexQuery,
                        params: [],
                        context: {
                            method: 'createSQLiteStorageInstance create indexes',
                            data: params.databaseName,
                        },
                    });
                }

                return 'COMMIT';
            },
            {
                indexCreation: false,
                databaseName: params.databaseName,
                collectionName: params.collectionName,
            }
        );
        return database;
    });

    const instance = new RxStorageInstanceSQLite(
        storage,
        params.databaseName,
        params.collectionName,
        params.schema,
        internals as any,
        params.options,
        settings,
        tableName,
        params.devMode
    );

    await addRxStorageMultiInstanceSupport(
        RX_STORAGE_NAME_SQLITE,
        params,
        instance
    );

    return instance;
}
