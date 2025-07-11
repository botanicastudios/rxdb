import { RxStorage, RxStorageInstanceCreationParams } from '../../index.ts';
import { RxStorageInstanceSQLite } from './sqlite-storage-instance.ts';
import type { SQLiteInternals, SQLiteInstanceCreationOptions, SQLiteStorageSettings } from './sqlite-types.ts';
export * from './sqlite-helpers.ts';
export * from './sqlite-types.ts';
export * from './sqlite-storage-instance.ts';
export * from './sqlite-basics-helpers.ts';
export declare class RxStorageSQLiteProd implements RxStorage<SQLiteInternals, SQLiteInstanceCreationOptions> {
    settings: SQLiteStorageSettings;
    name: string;
    readonly rxdbVersion = "16.16.0-fork";
    constructor(settings: SQLiteStorageSettings);
    createStorageInstance<RxDocType>(params: RxStorageInstanceCreationParams<RxDocType, SQLiteInstanceCreationOptions>): Promise<RxStorageInstanceSQLite<RxDocType>>;
}
export declare function getRxStorageSQLiteProd(settings: SQLiteStorageSettings): RxStorageSQLiteProd;
