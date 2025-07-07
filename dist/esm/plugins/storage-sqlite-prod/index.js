import { ensureRxStorageInstanceParamsAreCorrect } from "../../index.js";
import { RX_STORAGE_NAME_SQLITE } from "./sqlite-helpers.js";
import { createSQLiteTrialStorageInstance } from "./sqlite-storage-instance.js";
import { RXDB_VERSION } from "../utils/utils-rxdb-version.js";
export * from "./sqlite-helpers.js";
export * from "./sqlite-types.js";
export * from "./sqlite-storage-instance.js";
export * from "./sqlite-basics-helpers.js";
export var RxStorageSQLiteProd = /*#__PURE__*/function () {
  function RxStorageSQLiteProd(settings) {
    this.name = RX_STORAGE_NAME_SQLITE;
    this.rxdbVersion = RXDB_VERSION;
    this.settings = settings;
  }
  var _proto = RxStorageSQLiteProd.prototype;
  _proto.createStorageInstance = function createStorageInstance(params) {
    ensureRxStorageInstanceParamsAreCorrect(params);
    return createSQLiteTrialStorageInstance(this, params, this.settings);
  };
  return RxStorageSQLiteProd;
}();
var warningShown = false;
export function getRxStorageSQLiteProd(settings) {
  if (!warningShown) {
    warningShown = true;
    console.warn(['-------------- RxDB SQLite Production Version in Use -------------------------------', 'You are using the production version of the SQLite RxStorage from RxDB.', 'This is an improved version designed for production use with proper indexing and query optimization.', '-------------------------------------------------------------------------------'].join('\n'));
  }
  var storage = new RxStorageSQLiteProd(settings);
  return storage;
}
//# sourceMappingURL=index.js.map