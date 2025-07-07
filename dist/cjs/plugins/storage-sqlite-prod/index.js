"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  RxStorageSQLiteProd: true,
  getRxStorageSQLiteProd: true
};
exports.RxStorageSQLiteProd = void 0;
exports.getRxStorageSQLiteProd = getRxStorageSQLiteProd;
var _index = require("../../index.js");
var _sqliteHelpers = require("./sqlite-helpers.js");
Object.keys(_sqliteHelpers).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _sqliteHelpers[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _sqliteHelpers[key];
    }
  });
});
var _sqliteStorageInstance = require("./sqlite-storage-instance.js");
Object.keys(_sqliteStorageInstance).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _sqliteStorageInstance[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _sqliteStorageInstance[key];
    }
  });
});
var _utilsRxdbVersion = require("../utils/utils-rxdb-version.js");
var _sqliteTypes = require("./sqlite-types.js");
Object.keys(_sqliteTypes).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _sqliteTypes[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _sqliteTypes[key];
    }
  });
});
var _sqliteBasicsHelpers = require("./sqlite-basics-helpers.js");
Object.keys(_sqliteBasicsHelpers).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _sqliteBasicsHelpers[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _sqliteBasicsHelpers[key];
    }
  });
});
var RxStorageSQLiteProd = exports.RxStorageSQLiteProd = /*#__PURE__*/function () {
  function RxStorageSQLiteProd(settings) {
    this.name = _sqliteHelpers.RX_STORAGE_NAME_SQLITE;
    this.rxdbVersion = _utilsRxdbVersion.RXDB_VERSION;
    this.settings = settings;
  }
  var _proto = RxStorageSQLiteProd.prototype;
  _proto.createStorageInstance = function createStorageInstance(params) {
    (0, _index.ensureRxStorageInstanceParamsAreCorrect)(params);
    return (0, _sqliteStorageInstance.createSQLiteTrialStorageInstance)(this, params, this.settings);
  };
  return RxStorageSQLiteProd;
}();
var warningShown = false;
function getRxStorageSQLiteProd(settings) {
  if (!warningShown) {
    warningShown = true;
    console.warn(['-------------- RxDB SQLite Production Version in Use -------------------------------', 'You are using the production version of the SQLite RxStorage from RxDB.', 'This is an improved version designed for production use with proper indexing and query optimization.', '-------------------------------------------------------------------------------'].join('\n'));
  }
  var storage = new RxStorageSQLiteProd(settings);
  return storage;
}
//# sourceMappingURL=index.js.map