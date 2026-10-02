'use strict';

// A small in-memory Firestore with the parts functions/lib uses: documents,
// equality/in/range queries, transactions, batches, getAll, and the
// serverTimestamp and delete sentinels. Where it matters for correctness it
// behaves like the real one:
//   - transactions run one at a time (Firestore's are serializable), reads
//     come before writes, and a transaction's writes apply all or nothing;
//   - stricter than Firestore: a plain read or write made inside a
//     transaction's callback is refused, because with real concurrency it
//     would not be isolated (a read there could be stale and double-book);
//   - undefined field values, 'in' lists longer than 30 and an empty getAll()
//     are refused, as the Admin SDK refuses them;
//   - results come back in document id order (by the range field first when
//     a query has one).

const { AsyncLocalStorage } = require('node:async_hooks');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

// Set while a transaction's callback runs, outside its own transaction.get.
const insideTransaction = new AsyncLocalStorage();

function plainAccess(what) {
  if (insideTransaction.getStore()) throw new Error(`${what} inside a transaction must go through the transaction.`);
}

const DELETE = FieldValue.delete();
const SERVER_TIME = FieldValue.serverTimestamp();
const isSentinel = (value, sentinel) => value instanceof Object && typeof value.isEqual === 'function' && value.isEqual(sentinel);
const isPlain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

// Refuses undefined anywhere in `data`, like the Admin SDK.
function check(data, path = '') {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}${key}").`);
    if (isPlain(value)) check(value, `${path}${key}.`);
    if (Array.isArray(value)) value.forEach((item, index) => isPlain(item) && check(item, `${path}${key}.${index}.`));
  }
  return data;
}

// Stored form: delete sentinels drop their field; server timestamps, at any
// depth, become the current time.
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (isSentinel(value, SERVER_TIME)) return Timestamp.now();
  if (!isPlain(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => !isSentinel(item, DELETE))
    .map(([key, item]) => [key, resolve(item)]));
}

// Deep copy that keeps Timestamp objects intact.
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value;
}

function snapshot(ref, data) {
  return { id: ref.id, ref, exists: data !== undefined, data: () => copy(data) };
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const OPERATORS = {
  '==': (field, value) => field === value,
  in: (field, value) => value.includes(field),
  '<': (field, value) => field !== undefined && field < value,
  '>=': (field, value) => field !== undefined && field >= value
};

class DocRef {
  constructor(db, collection, id) {
    Object.assign(this, { db, collection, id, path: `${collection}/${id}` });
  }
  async get() {
    plainAccess(`Reading ${this.path}`);
    return snapshot(this, this.db.store.get(this.path));
  }
  async set(data) {
    plainAccess(`Writing ${this.path}`);
    this.db.store.set(this.path, resolve(check(data)));
  }
  async update(data) {
    plainAccess(`Writing ${this.path}`);
    if (!this.db.store.has(this.path)) throw Object.assign(new Error(`No document to update: ${this.path}`), { code: 5 });
    this.db.store.set(this.path, resolve({ ...this.db.store.get(this.path), ...check(data) }));
  }
  async delete() {
    plainAccess(`Writing ${this.path}`);
    this.db.store.delete(this.path);
  }
}

class Query {
  constructor(db, collection, filters = [], max = Infinity) {
    Object.assign(this, { db, collection, filters, max });
  }
  doc(id = `auto${String(++this.db.count).padStart(6, '0')}`) { return new DocRef(this.db, this.collection, id); }
  where(field, op, value) {
    if (!OPERATORS[op]) throw new Error(`The fake does not support the ${op} operator.`);
    if (op === 'in' && (!Array.isArray(value) || value.length === 0 || value.length > 30)) {
      throw new Error("'in' filters need a list of 1 to 30 values.");
    }
    return new Query(this.db, this.collection, [...this.filters, [field, op, value]], this.max);
  }
  limit(max) { return new Query(this.db, this.collection, this.filters, max); }
  async get() {
    plainAccess(`Querying ${this.collection}`);
    const docs = [];
    for (const [path, data] of this.db.store) {
      const [collection, id] = path.split('/');
      if (collection !== this.collection) continue;
      if (this.filters.every(([field, op, value]) => OPERATORS[op](data[field], value))) docs.push(snapshot(new DocRef(this.db, collection, id), data));
    }
    const range = this.filters.find(([, op]) => op === '<' || op === '>=')?.[0];
    docs.sort((a, b) => (range ? compare(a.data()[range], b.data()[range]) : 0) || compare(a.id, b.id));
    const limited = docs.slice(0, this.max);
    return { docs: limited, size: limited.length, empty: limited.length === 0 };
  }
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
    this.count = 0;
    this.queue = Promise.resolve();
  }

  collection(name) { return new Query(this, name); }

  seed(collection, id, data) { this.store.set(`${collection}/${id}`, copy(data)); }

  read(collection, id) { return this.store.get(`${collection}/${id}`); }

  // Every document in `collection`, with its id.
  all(collection) {
    return [...this.store].filter(([path]) => path.startsWith(`${collection}/`)).map(([path, data]) => ({ id: path.slice(collection.length + 1), ...data }));
  }

  clear() { this.store.clear(); }

  async getAll(...refs) {
    plainAccess('getAll()');
    if (!refs.length) throw new Error('getAll() needs at least one document.');
    return refs.map(ref => snapshot(ref, this.store.get(ref.path)));
  }

  batch() {
    const writes = [];
    return {
      delete: ref => writes.push(() => this.store.delete(ref.path)),
      commit: async () => {
        plainAccess('A batch');
        writes.forEach(write => write());
      }
    };
  }

  // One at a time, in the order they were started.
  runTransaction(work) {
    const run = this.queue.then(() => this.transact(work));
    this.queue = run.catch(() => {});
    return run;
  }

  async transact(work) {
    const writes = [];
    const transaction = {
      get: target => {
        if (writes.length) throw new Error('Firestore transactions require all reads before any writes.');
        return insideTransaction.exit(() => target.get());
      },
      create: (ref, data) => writes.push([ref, check(data), 'create']),
      set: (ref, data) => writes.push([ref, check(data), 'set']),
      update: (ref, data) => writes.push([ref, check(data), 'update']),
      delete: ref => writes.push([ref, null, 'delete'])
    };
    const result = await insideTransaction.run(true, () => work(transaction));
    // Work out every write against a staged copy first, so a failing write
    // leaves the store as it was.
    const staged = new Map();
    const current = path => (staged.has(path) ? staged.get(path) : this.store.get(path));
    for (const [ref, data, kind] of writes) {
      if (kind === 'create' && current(ref.path) !== undefined) throw Object.assign(new Error(`${ref.path} already exists`), { code: 6 });
      if (kind === 'update' && current(ref.path) === undefined) throw Object.assign(new Error(`${ref.path} does not exist`), { code: 5 });
      staged.set(ref.path, kind === 'delete' ? undefined : resolve(kind === 'update' ? { ...current(ref.path), ...data } : data));
    }
    for (const [path, data] of staged) {
      if (data === undefined) this.store.delete(path);
      else this.store.set(path, data);
    }
    return result;
  }
}

module.exports = { FakeFirestore };
