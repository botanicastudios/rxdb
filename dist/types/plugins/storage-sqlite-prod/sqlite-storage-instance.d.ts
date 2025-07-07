import { RxJsonSchema, RxStorageInstanceCreationParams, RxStorageInstance, EventBulk, RxStorageChangeEvent, RxDocumentData, BulkWriteRow, RxStorageBulkWriteResponse, RxStorageQueryResult, StringKeys, RxStorageDefaultCheckpoint, RxStorageCountResult, PreparedQuery } from '../../index.ts';
import { BehaviorSubject, Observable } from 'rxjs';
import type { RxStorageSQLiteProd } from './index.ts';
import type { SQLiteBasics, SQLiteInstanceCreationOptions, SQLiteInternals, SQLiteQueryWithParams, SQLiteStorageSettings } from './sqlite-types.ts';
export declare class RxStorageInstanceSQLite<RxDocType> implements RxStorageInstance<RxDocType, SQLiteInternals, SQLiteInstanceCreationOptions, RxStorageDefaultCheckpoint> {
    readonly storage: RxStorageSQLiteProd;
    readonly databaseName: string;
    readonly collectionName: string;
    readonly schema: Readonly<RxJsonSchema<RxDocumentData<RxDocType>>>;
    readonly internals: SQLiteInternals;
    readonly options: Readonly<SQLiteInstanceCreationOptions>;
    readonly settings: SQLiteStorageSettings;
    readonly tableName: string;
    readonly devMode: boolean;
    readonly primaryPath: StringKeys<RxDocType>;
    private changes$;
    readonly instanceId: number;
    closed?: Promise<void>;
    sqliteBasics: SQLiteBasics<any>;
    readonly openWriteCount$: BehaviorSubject<number>;
    constructor(storage: RxStorageSQLiteProd, databaseName: string, collectionName: string, schema: Readonly<RxJsonSchema<RxDocumentData<RxDocType>>>, internals: SQLiteInternals, options: Readonly<SQLiteInstanceCreationOptions>, settings: SQLiteStorageSettings, tableName: string, devMode: boolean);
    run(db: any, queryWithParams: SQLiteQueryWithParams): Promise<void>;
    all(db: any, queryWithParams: SQLiteQueryWithParams): Promise<import("./sqlite-types.ts").SQLResultRow[]>;
    /**
     * Converts RxDB queries to SQL for better performance.
     * Returns fallback info if query is too complex for SQL conversion.
     */
    private convertRxQueryToSQL;
    private convertSelectorToSQL;
    private convertMetaFieldToSQL;
    private convertOrToSQL;
    private convertAndToSQL;
    private convertFieldToSQL;
    private convertSortToSQL;
    private convertValueForSQL;
    private getJsonComparisonClause;
    /**
     * @link https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-insertions-971aff98eef2
     */
    bulkWrite(documentWrites: BulkWriteRow<RxDocType>[], context: string): Promise<RxStorageBulkWriteResponse<RxDocType>>;
    query(originalPreparedQuery: PreparedQuery<RxDocType>): Promise<RxStorageQueryResult<RxDocType>>;
    count(originalPreparedQuery: PreparedQuery<RxDocType>): Promise<RxStorageCountResult>;
    findDocumentsById(ids: string[], withDeleted: boolean): Promise<RxDocumentData<RxDocType>[]>;
    changeStream(): Observable<EventBulk<RxStorageChangeEvent<RxDocumentData<RxDocType>>, RxStorageDefaultCheckpoint>>;
    cleanup(minimumDeletedTime: number): Promise<boolean>;
    getAttachmentData(_documentId: string, _attachmentId: string): Promise<string>;
    remove(): Promise<void>;
    close(): Promise<void>;
}
export declare function createSQLiteTrialStorageInstance<RxDocType>(storage: RxStorageSQLiteProd, params: RxStorageInstanceCreationParams<RxDocType, SQLiteInstanceCreationOptions>, settings: SQLiteStorageSettings): Promise<RxStorageInstanceSQLite<RxDocType>>;
