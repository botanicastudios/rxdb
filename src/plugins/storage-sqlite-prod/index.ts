import {
    ensureRxStorageInstanceParamsAreCorrect,
    RxStorage,
    RxStorageInstanceCreationParams,
} from '../../index.ts';
import { RX_STORAGE_NAME_SQLITE } from './sqlite-helpers.ts';
import {
    createSQLiteTrialStorageInstance,
    RxStorageInstanceSQLite,
} from './sqlite-storage-instance.ts';
import type {
    SQLiteInternals,
    SQLiteInstanceCreationOptions,
    SQLiteStorageSettings,
} from './sqlite-types.ts';
import { RXDB_VERSION } from '../utils/utils-rxdb-version.ts';

export * from './sqlite-helpers.ts';
export * from './sqlite-types.ts';
export * from './sqlite-storage-instance.ts';
export * from './sqlite-basics-helpers.ts';

export class RxStorageSQLiteProd
    implements RxStorage<SQLiteInternals, SQLiteInstanceCreationOptions>
{
    public name = RX_STORAGE_NAME_SQLITE;
    readonly rxdbVersion = RXDB_VERSION;
    constructor(public settings: SQLiteStorageSettings) {}

    public createStorageInstance<RxDocType>(
        params: RxStorageInstanceCreationParams<
            RxDocType,
            SQLiteInstanceCreationOptions
        >
    ): Promise<RxStorageInstanceSQLite<RxDocType>> {
        ensureRxStorageInstanceParamsAreCorrect(params);
        return createSQLiteTrialStorageInstance(this, params, this.settings);
    }
}

let warningShown = false;

export function getRxStorageSQLiteProd(
    settings: SQLiteStorageSettings
): RxStorageSQLiteProd {
    if (!warningShown) {
        warningShown = true;
        console.warn(
            [
                '-------------- RxDB SQLite Production Version in Use -------------------------------',
                'You are using the production version of the SQLite RxStorage from RxDB.',
                'This is an improved version designed for production use with proper indexing and query optimization.',
                '-------------------------------------------------------------------------------',
            ].join('\n')
        );
    }

    const storage = new RxStorageSQLiteProd(settings);
    return storage;
}
