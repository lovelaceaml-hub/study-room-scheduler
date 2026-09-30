'use strict';

// A small in-memory Firestore with the parts functions/lib uses: documents,
// equality/in/range queries, transactions (reads must come before writes,
// as in Firestore), batches, getAll, and the serverTimestamp and delete
// sentinels.

const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const DELETE = FieldValue.delete();
const isDelete = value => value instanceof Object && typeof value.isEqual === 'function' && value.isEqual(DELETE);
const isServerTime = value => value instanceof Object && typeof value.isEqual === 'function' && value.isEqual(FieldValue.serverTimestamp());

function resolve(data) {
  return Object.fromEntries(Object.entries(data)
    .filter(([, value]) => !isDelete(value))
    .map(([key, value]) => [key, isServerTime(value) ? Timestamp.now() : value]));
}

// Deep copy that keeps Timestamp objects intact.
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }
  return value;
}

function snapshot(ref, data) {
  return { id: ref.id, ref, exists: data !== undefined, data: () => copy(data) };
}

const OPERATORS = {
  '==': (field, value) => field === value,
  in: (field, value) => value.includes(field),
  '<': (field, value) => field < value,
  '>=': (field, value) => field >= value
};

class DocRef {
  constructor(db, collection, id) {
    Object.assign(this, { db, collection, id, path: `${collection}/${id}` });
  }
  async get() { return snapshot(this, this.db.store.get(this.path)); }
  async set(data) { this.db.store.set(this.path, resolve(data)); }
  async delete() { this.db.store.delete(this.path); }
}

class Query {
  constructor(db, collection, filters = [], max = Infinity) {
    Object.assign(this, { db, collection, filters, max });
  }
  doc(id = `auto-${++this.db.count}`) { return new DocRef(this.db, this.collection, id); }
  where(field, op, value) { return new Query(this.db, this.collection, [...this.filters, [field, op, value]], this.max); }
  limit(max) { return new Query(this.db, this.collection, this.filters, max); }
  async get() {
    const docs = [];
    for (const [path, data] of this.db.store) {
      const [collection, id] = path.split('/');
      if (collection !== this.collection) continue;
      if (this.filters.every(([field, op, value]) => OPERATORS[op](data[field], value))) docs.push(snapshot(new DocRef(this.db, collection, id), data));
    }
    const limited = docs.slice(0, this.max);
    return { docs: limited, size: limited.length, empty: limited.length === 0 };
  }
}

class FakeFirestore {
  constructor() {
    this.store = new Map();
    this.count = 0;
  }

  collection(name) { return new Query(this, name); }

  seed(collection, id, data) { this.store.set(`${collection}/${id}`, copy(data)); }

  read(collection, id) { return this.store.get(`${collection}/${id}`); }

  async getAll(...refs) { return refs.map(ref => snapshot(ref, this.store.get(ref.path))); }

  batch() {
    const writes = [];
    return {
      delete: ref => writes.push(() => this.store.delete(ref.path)),
      commit: async () => writes.forEach(write => write())
    };
  }

  async runTransaction(work) {
    const writes = [];
    const transaction = {
      get: target => {
        if (writes.length) throw new Error('Firestore transactions require all reads before any writes.');
        return target.get();
      },
      create: (ref, data) => writes.push(() => {
        if (this.store.has(ref.path)) throw new Error(`${ref.path} already exists`);
        this.store.set(ref.path, resolve(data));
      }),
      set: (ref, data) => writes.push(() => this.store.set(ref.path, resolve(data))),
      update: (ref, data) => writes.push(() => {
        if (!this.store.has(ref.path)) throw new Error(`${ref.path} does not exist`);
        const next = { ...this.store.get(ref.path), ...data };
        this.store.set(ref.path, resolve(next));
      }),
      delete: ref => writes.push(() => this.store.delete(ref.path))
    };
    const result = await work(transaction);
    writes.forEach(write => write());
    return result;
  }
}

module.exports = { FakeFirestore };
