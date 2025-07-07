import _readOnlyError from "@babel/runtime/helpers/readOnlyError";
import { getPrimaryFieldOfPrimaryKey, categorizeBulkWriteRows, ensureNotFalsy, addRxStorageMultiInstanceSupport, promiseWait, getQueryMatcher } from "../../index.js";
import { BehaviorSubject, Subject, filter, firstValueFrom } from 'rxjs';
import { closeDatabaseConnection, ensureParamsCountIsCorrect, getDatabaseConnection, getSQLiteUpdateSQL, RX_STORAGE_NAME_SQLITE, sqliteTransaction, getDataFromResultRow, getSQLiteInsertSQL, TX_QUEUE_BY_DATABASE } from "./sqlite-helpers.js";
import { getSortComparator } from "../../rx-query-helper.js";
import { newRxError } from "../../rx-error.js";
var instanceId = 0;
export var RxStorageInstanceSQLite = /*#__PURE__*/function () {
  function RxStorageInstanceSQLite(storage, databaseName, collectionName, schema, internals, options, settings, tableName, devMode) {
    this.changes$ = new Subject();
    this.instanceId = instanceId++;
    this.openWriteCount$ = new BehaviorSubject(0);
    this.storage = storage;
    this.databaseName = databaseName;
    this.collectionName = collectionName;
    this.schema = schema;
    this.internals = internals;
    this.options = options;
    this.settings = settings;
    this.tableName = tableName;
    this.devMode = devMode;
    this.sqliteBasics = storage.settings.sqliteBasics;
    this.primaryPath = getPrimaryFieldOfPrimaryKey(this.schema.primaryKey);
  }
  var _proto = RxStorageInstanceSQLite.prototype;
  _proto.run = function run(db, queryWithParams) {
    if (this.devMode) {
      ensureParamsCountIsCorrect(queryWithParams);
    }
    return this.sqliteBasics.run(db, queryWithParams);
  };
  _proto.all = function all(db, queryWithParams) {
    if (this.devMode) {
      ensureParamsCountIsCorrect(queryWithParams);
    }
    return this.sqliteBasics.all(db, queryWithParams);
  }

  /**
   * Converts RxDB queries to SQL for better performance.
   * Returns fallback info if query is too complex for SQL conversion.
   */;
  _proto.convertRxQueryToSQL = function convertRxQueryToSQL(query) {
    try {
      var sqlParts = ["SELECT data FROM \"" + this.tableName + "\""];
      var whereClauses = [];
      var params = [];
      var orderBy = [];
      var selector = query.selector || {};

      // Let RxDB handle deleted document filtering at the application level
      // Only add deleted filter if the query explicitly requests it

      // Convert selector to SQL WHERE clauses
      var selectorResult = this.convertSelectorToSQL(selector, params);
      if (!selectorResult.canConvert) {
        return {
          canUseSql: false
        };
      }
      whereClauses.push(...selectorResult.clauses);

      // Handle sorting
      if (query.sort) {
        var sortResult = this.convertSortToSQL(query.sort);
        if (!sortResult.canConvert) {
          return {
            canUseSql: false
          };
        }
        orderBy.push(...sortResult.clauses);
      }

      // Build the final SQL
      if (whereClauses.length > 0) {
        sqlParts.push("WHERE " + whereClauses.join(' AND '));
      }
      if (orderBy.length > 0) {
        sqlParts.push("ORDER BY " + orderBy.join(', '));
      }

      // Handle limit and skip
      if (query.limit !== undefined) {
        sqlParts.push("LIMIT ?");
        params.push(query.limit);
      }
      if (query.skip !== undefined && query.skip > 0) {
        sqlParts.push("OFFSET ?");
        params.push(query.skip);
      }
      var sql = sqlParts.join(' ');
      return {
        canUseSql: true,
        sql,
        params
      };
    } catch (error) {
      // If anything goes wrong, fallback to JS
      return {
        canUseSql: false
      };
    }
  };
  _proto.convertSelectorToSQL = function convertSelectorToSQL(selector, params) {
    var clauses = [];
    for (var [field, value] of Object.entries(selector)) {
      if (field === '_deleted') {
        // Handle deleted field - RxDB uses boolean, SQLite uses integer
        if (typeof value === 'object' && value !== null && '$eq' in value) {
          clauses.push('deleted = ?');
          params.push(value.$eq ? 1 : 0);
        } else {
          clauses.push('deleted = ?');
          params.push(value ? 1 : 0);
        }
      } else if (field === '_meta' && typeof value === 'object' && value !== null) {
        // Handle _meta.lwt queries
        var metaResult = this.convertMetaFieldToSQL(value, params);
        if (!metaResult.canConvert) {
          return {
            canConvert: false,
            clauses: []
          };
        }
        clauses.push(...metaResult.clauses);
      } else if (field === '$or') {
        // Handle $or queries
        var orResult = this.convertOrToSQL(value, params);
        if (!orResult.canConvert) {
          return {
            canConvert: false,
            clauses: []
          };
        }
        clauses.push(orResult.clause);
      } else if (field === '$and') {
        // Handle $and queries
        var andResult = this.convertAndToSQL(value, params);
        if (!andResult.canConvert) {
          return {
            canConvert: false,
            clauses: []
          };
        }
        clauses.push(...andResult.clauses);
      } else {
        // Handle regular document fields
        var fieldResult = this.convertFieldToSQL(field, value, params);
        if (!fieldResult.canConvert) {
          return {
            canConvert: false,
            clauses: []
          };
        }
        clauses.push(fieldResult.clause);
      }
    }
    return {
      canConvert: true,
      clauses
    };
  };
  _proto.convertMetaFieldToSQL = function convertMetaFieldToSQL(metaValue, params) {
    var clauses = [];
    if (metaValue.lwt !== undefined) {
      if (typeof metaValue.lwt === 'object') {
        // Handle operators like $gt, $lt, etc.
        for (var [op, opValue] of Object.entries(metaValue.lwt)) {
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
              return {
                canConvert: false,
                clauses: []
              };
          }
        }
      } else {
        clauses.push('lastWriteTime = ?');
        params.push(metaValue.lwt);
      }
    }
    return {
      canConvert: true,
      clauses
    };
  };
  _proto.convertOrToSQL = function convertOrToSQL(orConditions, params) {
    var orClauses = [];
    for (var condition of orConditions) {
      // Don't let sub-conditions handle _deleted - we handle it at the top level
      var cleanCondition = {
        ...condition
      };
      delete cleanCondition._deleted;
      var conditionResult = this.convertSelectorToSQL(cleanCondition, params);
      if (!conditionResult.canConvert) {
        return {
          canConvert: false,
          clause: ''
        };
      }
      if (conditionResult.clauses.length > 0) {
        orClauses.push("(" + conditionResult.clauses.join(' AND ') + ")");
      } else {
        // If a condition produces no clauses, it means "match all"
        // For OR, if any sub-condition matches all, the whole OR matches all
        orClauses.push('1=1');
      }
    }
    if (orClauses.length === 0) {
      return {
        canConvert: false,
        clause: ''
      };
    }
    return {
      canConvert: true,
      clause: "(" + orClauses.join(' OR ') + ")"
    };
  };
  _proto.convertAndToSQL = function convertAndToSQL(andConditions, params) {
    var andClauses = [];
    for (var condition of andConditions) {
      var conditionResult = this.convertSelectorToSQL(condition, params);
      if (!conditionResult.canConvert) {
        return {
          canConvert: false,
          clauses: []
        };
      }
      andClauses.push(...conditionResult.clauses);
    }
    return {
      canConvert: true,
      clauses: andClauses
    };
  };
  _proto.convertFieldToSQL = function convertFieldToSQL(field, value, params) {
    var isPrimaryKey = field === this.primaryPath;
    var jsonPath = isPrimaryKey ? '$.id' : "$." + field;
    if (value === null) {
      if (isPrimaryKey) {
        return {
          canConvert: true,
          clause: "id IS NULL"
        };
      } else {
        return {
          canConvert: true,
          clause: "json_extract(data, '" + jsonPath + "') IS NULL"
        };
      }
    }
    if (typeof value === 'object' && value !== null) {
      // Handle operators
      if (value.hasOwnProperty('$exists')) {
        if (value.$exists === false) {
          return {
            canConvert: true,
            clause: "json_extract(data, '" + jsonPath + "') IS NULL"
          };
        } else if (value.$exists === true) {
          return {
            canConvert: true,
            clause: "json_extract(data, '" + jsonPath + "') IS NOT NULL"
          };
        }
      }
      if (value.hasOwnProperty('$eq')) {
        var _sqlValue = this.convertValueForSQL(value.$eq);
        params.push(_sqlValue);
        return {
          canConvert: true,
          clause: isPrimaryKey ? "id = ?" : "json_extract(data, '" + jsonPath + "') = ?"
        };
      }
      if (value.hasOwnProperty('$ne')) {
        var _sqlValue2 = this.convertValueForSQL(value.$ne);
        params.push(_sqlValue2);
        if (isPrimaryKey) {
          return {
            canConvert: true,
            clause: "id != ?"
          };
        } else {
          // For JSON fields, $ne should also match NULL values (missing fields)
          // because in MongoDB/RxDB, missing fields are considered different from any value
          return {
            canConvert: true,
            clause: "(json_extract(data, '" + jsonPath + "') != ? OR json_extract(data, '" + jsonPath + "') IS NULL)"
          };
        }
      }
      if (value.hasOwnProperty('$in')) {
        var inValues = value.$in;
        if (!Array.isArray(inValues) || inValues.length === 0) {
          return {
            canConvert: false,
            clause: ''
          };
        }
        var placeholders = inValues.map(() => '?').join(',');
        var sqlValues = inValues.map(v => this.convertValueForSQL(v));
        params.push(...sqlValues);
        return {
          canConvert: true,
          clause: isPrimaryKey ? "id IN (" + placeholders + ")" : "json_extract(data, '" + jsonPath + "') IN (" + placeholders + ")"
        };
      }
      if (value.hasOwnProperty('$nin')) {
        var ninValues = value.$nin;
        if (!Array.isArray(ninValues) || ninValues.length === 0) {
          return {
            canConvert: false,
            clause: ''
          };
        }
        var _placeholders = ninValues.map(() => '?').join(',');
        var _sqlValues = ninValues.map(v => this.convertValueForSQL(v));
        params.push(..._sqlValues);
        return {
          canConvert: true,
          clause: isPrimaryKey ? "id NOT IN (" + _placeholders + ")" : "json_extract(data, '" + jsonPath + "') NOT IN (" + _placeholders + ")"
        };
      }

      // Comparison operators
      for (var [op, opValue] of Object.entries(value)) {
        switch (op) {
          case '$gt':
            params.push(this.convertValueForSQL(opValue));
            return {
              canConvert: true,
              clause: isPrimaryKey ? "id > ?" : this.getJsonComparisonClause(jsonPath, '>', typeof opValue === 'number')
            };
          case '$gte':
            params.push(this.convertValueForSQL(opValue));
            return {
              canConvert: true,
              clause: isPrimaryKey ? "id >= ?" : this.getJsonComparisonClause(jsonPath, '>=', typeof opValue === 'number')
            };
          case '$lt':
            params.push(this.convertValueForSQL(opValue));
            return {
              canConvert: true,
              clause: isPrimaryKey ? "id < ?" : this.getJsonComparisonClause(jsonPath, '<', typeof opValue === 'number')
            };
          case '$lte':
            params.push(this.convertValueForSQL(opValue));
            return {
              canConvert: true,
              clause: isPrimaryKey ? "id <= ?" : this.getJsonComparisonClause(jsonPath, '<=', typeof opValue === 'number')
            };
          case '$regex':
            // SQLite doesn't have native regex, fall back to JS
            return {
              canConvert: false,
              clause: ''
            };
          default:
            // Unsupported operator, fall back to JS
            return {
              canConvert: false,
              clause: ''
            };
        }
      }

      // Complex object, fall back to JS
      return {
        canConvert: false,
        clause: ''
      };
    }

    // Simple equality
    var sqlValue = this.convertValueForSQL(value);
    params.push(sqlValue);
    return {
      canConvert: true,
      clause: isPrimaryKey ? "id = ?" : "json_extract(data, '" + jsonPath + "') = ?"
    };
  };
  _proto.convertSortToSQL = function convertSortToSQL(sort) {
    var clauses = [];
    for (var sortItem of sort) {
      var field = Object.keys(sortItem)[0];
      var direction = sortItem[field] === 'desc' ? 'DESC' : 'ASC';
      if (field === '_meta.lwt') {
        clauses.push("lastWriteTime " + direction);
      } else if (field === this.primaryPath) {
        clauses.push("id " + direction);
      } else {
        // Sort by JSON field
        var jsonPath = "$." + field;
        clauses.push("json_extract(data, '" + jsonPath + "') " + direction);
      }
    }
    return {
      canConvert: true,
      clauses
    };
  };
  _proto.convertValueForSQL = function convertValueForSQL(value) {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  };
  _proto.getJsonComparisonClause = function getJsonComparisonClause(jsonPath, operator, isNumeric) {
    if (isNumeric) {
      // For numeric comparisons, cast to REAL to ensure proper numeric comparison
      return "CAST(json_extract(data, '" + jsonPath + "') AS REAL) " + operator + " ?";
    } else {
      // For text comparisons, use regular json_extract
      return "json_extract(data, '" + jsonPath + "') " + operator + " ?";
    }
  }

  /**
   * @link https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-insertions-971aff98eef2
   */;
  _proto.bulkWrite = async function bulkWrite(documentWrites, context) {
    this.openWriteCount$.next(this.openWriteCount$.getValue() + 1);
    var database = await this.internals.databasePromise;
    var ret = {
      error: []
    };
    var writePromises = [];
    var categorized = {};
    await sqliteTransaction(database, this.sqliteBasics, async () => {
      if (this.closed) {
        this.openWriteCount$.next(this.openWriteCount$.getValue() - 1);
        throw new Error('SQLite.bulkWrite(' + context + ') already closed ' + this.tableName + ' context: ' + context);
      }
      // Extract IDs from the documents being written
      var idsToQuery = documentWrites.map(row => row.document[this.primaryPath]);
      var docsInDb = new Map();

      // Only query the specific documents we're writing, not everything
      if (idsToQuery.length > 0) {
        var placeholders = idsToQuery.map(() => '?').join(',');
        var result = await this.all(database, {
          query: "SELECT data FROM \"" + this.tableName + "\" WHERE id IN (" + placeholders + ")",
          params: idsToQuery,
          context: {
            method: 'bulkWrite',
            data: documentWrites
          }
        });
        result.forEach(docSQLResult => {
          var doc = JSON.parse(getDataFromResultRow(docSQLResult));
          var id = doc[this.primaryPath];
          docsInDb.set(id, doc);
        });
      }
      categorized = categorizeBulkWriteRows(this, this.primaryPath, docsInDb, documentWrites, context);
      ret.error = categorized.errors;
      categorized.bulkInsertDocs.forEach(row => {
        var insertQuery = getSQLiteInsertSQL(this.tableName, this.primaryPath, row.document);
        writePromises.push(this.all(database, {
          query: insertQuery.query,
          params: insertQuery.params,
          context: {
            method: 'bulkWrite',
            data: categorized
          }
        }));
      });
      categorized.bulkUpdateDocs.forEach(row => {
        var updateQuery = getSQLiteUpdateSQL(this.tableName, this.primaryPath, row);
        writePromises.push(this.run(database, updateQuery));
      });
      await Promise.all(writePromises);

      // close transaction
      if (this.closed) {
        this.openWriteCount$.next(this.openWriteCount$.getValue() - 1);
        return 'ROLLBACK';
      } else {
        this.openWriteCount$.next(this.openWriteCount$.getValue() - 1);
        return 'COMMIT';
      }
    }, {
      databaseName: this.databaseName,
      collectionName: this.collectionName
    });
    if (categorized && categorized.eventBulk.events.length > 0) {
      var lastState = ensureNotFalsy(categorized.newestRow).document;
      categorized.eventBulk.checkpoint = {
        id: lastState[this.primaryPath],
        lwt: lastState._meta.lwt
      };
      this.changes$.next(categorized.eventBulk);
    }
    return ret;
  };
  _proto.query = async function query(originalPreparedQuery) {
    var database = await this.internals.databasePromise;
    var query = originalPreparedQuery.query;

    // Try to convert to SQL query for better performance
    var sqlQuery = this.convertRxQueryToSQL(query);
    if (sqlQuery.canUseSql) {
      // Use optimized SQL query
      if (this.devMode) {
        console.log("\uD83D\uDCCA SQL Optimization: Using SQL query for better performance");
        console.log("   SQL: " + sqlQuery.sql);
        console.log("   Params: " + JSON.stringify(sqlQuery.params));
      }
      var subResult = await this.all(database, {
        query: sqlQuery.sql,
        params: sqlQuery.params,
        context: {
          method: 'query',
          data: originalPreparedQuery
        }
      });
      var result = [];
      subResult.forEach(row => {
        var docData = JSON.parse(getDataFromResultRow(row));
        result.push(docData);
      });
      return {
        documents: result
      };
    } else {
      // Fallback to in-memory filtering for complex queries
      if (this.devMode) {
        console.log("\uD83D\uDD04 Fallback: Using JavaScript filtering for complex query");
        console.log("   Query: " + JSON.stringify(query, null, 2));
      }
      var skip = query.skip ? query.skip : 0;
      var limit = query.limit ? query.limit : Infinity;
      var skipPlusLimit = skip + limit;
      var queryMatcher = getQueryMatcher(this.schema, query);
      var _subResult = await this.all(database, {
        query: 'SELECT data FROM "' + this.tableName + '"',
        params: [],
        context: {
          method: 'query',
          data: originalPreparedQuery
        }
      });
      var _result = [];
      _subResult.forEach(row => {
        var docData = JSON.parse(getDataFromResultRow(row));
        if (queryMatcher(docData)) {
          _result.push(docData);
        }
      });
      var sortComparator = getSortComparator(this.schema, query);
      _result = _result.sort(sortComparator);
      _result = _result.slice(skip, skipPlusLimit);
      return {
        documents: _result
      };
    }
  };
  _proto.count = async function count(originalPreparedQuery) {
    var database = await this.internals.databasePromise;
    var query = originalPreparedQuery.query;

    // Try to use SQL COUNT for better performance
    var sqlQuery = this.convertRxQueryToSQL(query);
    if (sqlQuery.canUseSql) {
      // Convert SELECT to COUNT query
      var countSql = sqlQuery.sql.replace("SELECT data FROM \"" + this.tableName + "\"", "SELECT COUNT(*) as count FROM \"" + this.tableName + "\"");

      // Remove LIMIT and OFFSET for count (they don't affect count)
      var cleanCountSql = countSql.replace(/\s+LIMIT\s+\?/gi, '').replace(/\s+OFFSET\s+\?/gi, '');

      // Remove corresponding LIMIT/OFFSET parameters
      var countParams = [...sqlQuery.params];
      if (query.limit !== undefined) {
        countParams.pop(); // Remove limit param
      }
      if (query.skip !== undefined && query.skip > 0) {
        countParams.pop(); // Remove offset param
      }
      if (this.devMode) {
        console.log("\uD83D\uDCCA SQL Count: Using optimized COUNT query");
        console.log("   SQL: " + cleanCountSql);
        console.log("   Params: " + JSON.stringify(countParams));
      }
      var result = await this.all(database, {
        query: cleanCountSql,
        params: countParams,
        context: {
          method: 'count',
          data: originalPreparedQuery
        }
      });

      // Extract count from the result row
      var countValue = Array.isArray(result[0]) ? result[0][0] : result[0].count;
      return {
        count: countValue || 0,
        mode: 'fast'
      };
    } else {
      // Fallback to full query and count in memory
      var results = await this.query(originalPreparedQuery);
      return {
        count: results.documents.length,
        mode: 'fast'
      };
    }
  };
  _proto.findDocumentsById = async function findDocumentsById(ids, withDeleted) {
    var database = await this.internals.databasePromise;
    if (this.closed) {
      throw new Error('SQLite.findDocumentsById() already closed ' + this.tableName + ' context: findDocumentsById');
    }
    if (ids.length === 0) {
      return [];
    }

    // Create placeholders for the IN clause
    var placeholders = ids.map(() => '?').join(',');
    var query = "SELECT data FROM \"" + this.tableName + "\" WHERE id IN (" + placeholders + ")";
    var params = [...ids];

    // Filter out deleted documents unless explicitly requested
    if (!withDeleted) {
      query += ' AND deleted = 0';
    }
    var result = await this.all(database, {
      query,
      params,
      context: {
        method: 'findDocumentsById',
        data: ids
      }
    });
    var ret = [];
    for (var i = 0; i < result.length; ++i) {
      var resultRow = result[i];
      var doc = JSON.parse(getDataFromResultRow(resultRow));
      ret.push(doc);
    }
    return ret;
  };
  _proto.changeStream = function changeStream() {
    return this.changes$.asObservable();
  };
  _proto.cleanup = async function cleanup(minimumDeletedTime) {
    await promiseWait(0);
    await promiseWait(0);
    var database = await this.internals.databasePromise;

    /**
     * Purge deleted documents
     */
    var minTimestamp = new Date().getTime() - minimumDeletedTime;
    await this.all(database, {
      query: "\n                    DELETE FROM\n                        \"" + this.tableName + "\"\n                    WHERE\n                        deleted = 1\n                        AND\n                        lastWriteTime < ?\n                ",
      params: [minTimestamp],
      context: {
        method: 'cleanup',
        data: minimumDeletedTime
      }
    });
    return true;
  };
  _proto.getAttachmentData = async function getAttachmentData(_documentId, _attachmentId) {
    throw newRxError('SQL1');
  };
  _proto.remove = async function remove() {
    if (this.closed) {
      throw new Error('closed already');
    }
    var database = await this.internals.databasePromise;
    var promises = [this.run(database, {
      query: "DROP TABLE IF EXISTS \"" + this.tableName + "\"",
      params: [],
      context: {
        method: 'remove',
        data: this.tableName
      }
    })];
    await Promise.all(promises);
    return this.close();
  };
  _proto.close = async function close() {
    var queue = TX_QUEUE_BY_DATABASE.get(await this.internals.databasePromise);
    if (queue) {
      await queue;
    }
    if (this.closed) {
      return this.closed;
    }
    this.closed = (async () => {
      await firstValueFrom(this.openWriteCount$.pipe(filter(v => v === 0)));
      var database = await this.internals.databasePromise;

      /**
       * First get a transaction
       * to ensure currently running operations
       * are finished
       */
      await sqliteTransaction(database, this.sqliteBasics, () => {
        return Promise.resolve('COMMIT');
      }).catch(() => {});
      this.changes$.complete();
      await closeDatabaseConnection(this.databaseName, this.storage.settings.sqliteBasics);
    })();
    return this.closed;
  };
  return RxStorageInstanceSQLite;
}();
export async function createSQLiteTrialStorageInstance(storage, params, settings) {
  var sqliteBasics = settings.sqliteBasics;
  var tableName = params.collectionName + '-' + params.schema.version;
  if (params.schema.attachments) {
    throw newRxError('SQL1');
  }
  var internals = {};
  var useDatabaseName = (settings.databaseNamePrefix ? settings.databaseNamePrefix : '') + params.databaseName;
  internals.databasePromise = getDatabaseConnection(storage.settings.sqliteBasics, useDatabaseName).then(async database => {
    await sqliteTransaction(database, sqliteBasics, async () => {
      // Create the main table
      var tableQuery = "\n                CREATE TABLE IF NOT EXISTS \"" + tableName + "\"(\n                    id TEXT NOT NULL PRIMARY KEY UNIQUE,\n                    revision TEXT,\n                    deleted BOOLEAN NOT NULL CHECK (deleted IN (0, 1)),\n                    lastWriteTime INTEGER NOT NULL,\n                    data json\n                );\n                ";
      await sqliteBasics.run(database, {
        query: tableQuery,
        params: [],
        context: {
          method: 'createSQLiteStorageInstance create tables',
          data: params.databaseName
        }
      });

      // Create performance indexes - only on universal RxDB metadata fields
      var indexes = [// Core RxDB metadata indexes that every collection has
      "CREATE INDEX IF NOT EXISTS \"idx_" + tableName + "_deleted\" ON \"" + tableName + "\" (deleted);", "CREATE INDEX IF NOT EXISTS \"idx_" + tableName + "_lwt\" ON \"" + tableName + "\" (lastWriteTime);", "CREATE INDEX IF NOT EXISTS \"idx_" + tableName + "_deleted_lwt\" ON \"" + tableName + "\" (deleted, lastWriteTime);" // Note: Additional application-specific indexes should be created by the application
      // using the schema.indexes property in RxDB, not hardcoded in the storage layer.
      // The SQL query optimization engine will dynamically handle any field names.
      ];
      for (var indexQuery of indexes) {
        await sqliteBasics.run(database, {
          query: indexQuery,
          params: [],
          context: {
            method: 'createSQLiteStorageInstance create indexes',
            data: params.databaseName
          }
        });
      }
      return 'COMMIT';
    }, {
      indexCreation: false,
      databaseName: params.databaseName,
      collectionName: params.collectionName
    });
    return database;
  });
  var instance = new RxStorageInstanceSQLite(storage, params.databaseName, params.collectionName, params.schema, internals, params.options, settings, tableName, params.devMode);
  await addRxStorageMultiInstanceSupport(RX_STORAGE_NAME_SQLITE, params, instance);
  return instance;
}
//# sourceMappingURL=sqlite-storage-instance.js.map