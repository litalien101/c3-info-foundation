const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'foundation.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    uri TEXT,
    title TEXT,
    publisher TEXT,
    published_at TEXT,
    retrieved_at TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS raw_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    content_hash TEXT,
    mime_type TEXT,
    byte_size INTEGER,
    storage_location TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id)
  );

  CREATE TABLE IF NOT EXISTS content_representations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id INTEGER,
    processing_version TEXT,
    representation_type TEXT,
    metadata TEXT,
    FOREIGN KEY (artifact_id) REFERENCES raw_artifacts(id)
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_representation_id INTEGER,
    sequence INTEGER,
    content TEXT,
    location_metadata TEXT,
    FOREIGN KEY (content_representation_id) REFERENCES content_representations(id)
  );

  CREATE TABLE IF NOT EXISTS extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    artifact_id INTEGER,
    processing_version TEXT,
    schema_version TEXT,
    method TEXT,
    model TEXT,
    model_version TEXT,
    prompt_version TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(id),
    FOREIGN KEY (artifact_id) REFERENCES raw_artifacts(id)
  );

  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id INTEGER,
    type TEXT,
    canonical_name TEXT,
    attributes TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id INTEGER,
    claim_type TEXT,
    subject TEXT,
    predicate TEXT,
    object TEXT,
    attributes TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id INTEGER,
    observation_type TEXT,
    subject TEXT,
    value TEXT,
    unit TEXT,
    attributes TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id INTEGER,
    relationship_type TEXT,
    source_entity TEXT,
    target_entity TEXT,
    attributes TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id INTEGER,
    content_representation_id INTEGER,
    chunk_id INTEGER,
    source_location TEXT,
    metadata TEXT,
    FOREIGN KEY (artifact_id) REFERENCES raw_artifacts(id),
    FOREIGN KEY (content_representation_id) REFERENCES content_representations(id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
  );

  CREATE TABLE IF NOT EXISTS scopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id INTEGER,
    geography TEXT,
    population TEXT,
    time_period TEXT,
    conditions TEXT,
    definitions TEXT,
    metadata TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS entity_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_a_id INTEGER,
    entity_b_id INTEGER,
    match_status TEXT,
    confidence REAL,
    reasoning TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT,
    target_id INTEGER,
    status TEXT,
    reviewer TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT,
    target_id INTEGER,
    version TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    change_metadata TEXT
  );
`);

function serializeMetadata(metadata) {
  return metadata == null ? null : JSON.stringify(metadata);
}

function deserializeRows(rows, fields = []) {
  return rows.map((row) => {
    const next = { ...row };
    for (const field of fields) {
      if (next[field] != null && typeof next[field] === 'string') {
        try {
          next[field] = JSON.parse(next[field]);
        } catch (_err) {
          next[field] = next[field];
        }
      }
    }
    return next;
  });
}

function insertSource({ type, uri, title, publisher = null, published_at = null, retrieved_at = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO sources (type, uri, title, publisher, published_at, retrieved_at, metadata)
    VALUES (@type, @uri, @title, @publisher, @published_at, @retrieved_at, @metadata)
  `);
  const result = stmt.run({
    type,
    uri,
    title,
    publisher,
    published_at,
    retrieved_at,
    metadata: serializeMetadata(metadata)
  });
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
}

function insertArtifact({ source_id, content_hash, mime_type, byte_size, storage_location, created_at = new Date().toISOString() }) {
  const stmt = db.prepare(`
    INSERT INTO raw_artifacts (source_id, content_hash, mime_type, byte_size, storage_location, created_at)
    VALUES (@source_id, @content_hash, @mime_type, @byte_size, @storage_location, @created_at)
  `);
  const result = stmt.run({
    source_id,
    content_hash,
    mime_type,
    byte_size,
    storage_location,
    created_at
  });
  return db.prepare('SELECT * FROM raw_artifacts WHERE id = ?').get(result.lastInsertRowid);
}

function insertContentRepresentation({ artifact_id, processing_version = '1.0', representation_type = 'text', metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO content_representations (artifact_id, processing_version, representation_type, metadata)
    VALUES (@artifact_id, @processing_version, @representation_type, @metadata)
  `);
  const result = stmt.run({
    artifact_id,
    processing_version,
    representation_type,
    metadata: serializeMetadata(metadata)
  });
  return db.prepare('SELECT * FROM content_representations WHERE id = ?').get(result.lastInsertRowid);
}

function insertChunk({ content_representation_id, sequence, content, location_metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO chunks (content_representation_id, sequence, content, location_metadata)
    VALUES (@content_representation_id, @sequence, @content, @location_metadata)
  `);
  const result = stmt.run({
    content_representation_id,
    sequence,
    content,
    location_metadata: serializeMetadata(location_metadata)
  });
  return db.prepare('SELECT * FROM chunks WHERE id = ?').get(result.lastInsertRowid);
}

function insertExtraction({ source_id, artifact_id, processing_version = '1.0', schema_version = '1.0', method = 'heuristic', model = 'local', model_version = 'n/a', prompt_version = 'n/a', created_at = new Date().toISOString(), status = 'completed' }) {
  const stmt = db.prepare(`
    INSERT INTO extractions (source_id, artifact_id, processing_version, schema_version, method, model, model_version, prompt_version, created_at, status)
    VALUES (@source_id, @artifact_id, @processing_version, @schema_version, @method, @model, @model_version, @prompt_version, @created_at, @status)
  `);
  const result = stmt.run({
    source_id,
    artifact_id,
    processing_version,
    schema_version,
    method,
    model,
    model_version,
    prompt_version,
    created_at,
    status
  });
  return db.prepare('SELECT * FROM extractions WHERE id = ?').get(result.lastInsertRowid);
}

function insertEntity({ extraction_id, type, canonical_name, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO entities (extraction_id, type, canonical_name, attributes)
    VALUES (@extraction_id, @type, @canonical_name, @attributes)
  `);
  const result = stmt.run({
    extraction_id,
    type,
    canonical_name,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM entities WHERE id = ?').get(result.lastInsertRowid);
}

function insertClaim({ extraction_id, claim_type = 'claim', subject, predicate, object, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO claims (extraction_id, claim_type, subject, predicate, object, attributes)
    VALUES (@extraction_id, @claim_type, @subject, @predicate, @object, @attributes)
  `);
  const result = stmt.run({
    extraction_id,
    claim_type,
    subject,
    predicate,
    object,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM claims WHERE id = ?').get(result.lastInsertRowid);
}

function insertObservation({ extraction_id, observation_type = 'observation', subject, value, unit = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO observations (extraction_id, observation_type, subject, value, unit, attributes)
    VALUES (@extraction_id, @observation_type, @subject, @value, @unit, @attributes)
  `);
  const result = stmt.run({
    extraction_id,
    observation_type,
    subject,
    value,
    unit,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM observations WHERE id = ?').get(result.lastInsertRowid);
}

function insertRelationship({ extraction_id, relationship_type, source_entity, target_entity, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO relationships (extraction_id, relationship_type, source_entity, target_entity, attributes)
    VALUES (@extraction_id, @relationship_type, @source_entity, @target_entity, @attributes)
  `);
  const result = stmt.run({
    extraction_id,
    relationship_type,
    source_entity,
    target_entity,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM relationships WHERE id = ?').get(result.lastInsertRowid);
}

function insertEvidence({ artifact_id, content_representation_id, chunk_id, source_location, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO evidence (artifact_id, content_representation_id, chunk_id, source_location, metadata)
    VALUES (@artifact_id, @content_representation_id, @chunk_id, @source_location, @metadata)
  `);
  const result = stmt.run({
    artifact_id,
    content_representation_id,
    chunk_id,
    source_location,
    metadata: serializeMetadata(metadata)
  });
  return db.prepare('SELECT * FROM evidence WHERE id = ?').get(result.lastInsertRowid);
}

function insertScope({ extraction_id, geography = null, population = null, time_period = null, conditions = null, definitions = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO scopes (extraction_id, geography, population, time_period, conditions, definitions, metadata)
    VALUES (@extraction_id, @geography, @population, @time_period, @conditions, @definitions, @metadata)
  `);
  const result = stmt.run({
    extraction_id,
    geography,
    population,
    time_period,
    conditions,
    definitions,
    metadata: serializeMetadata(metadata)
  });
  return db.prepare('SELECT * FROM scopes WHERE id = ?').get(result.lastInsertRowid);
}

function getArtifactByHash(contentHash) {
  return db.prepare('SELECT * FROM raw_artifacts WHERE content_hash = ? ORDER BY id DESC LIMIT 1').get(contentHash);
}

function listSources() {
  return deserializeRows(db.prepare('SELECT * FROM sources ORDER BY id DESC').all(), ['metadata']);
}

function listArtifacts() {
  return deserializeRows(db.prepare('SELECT * FROM raw_artifacts ORDER BY id DESC').all(), []);
}

function listRecords() {
  return {
    sources: listSources(),
    artifacts: listArtifacts(),
    entities: deserializeRows(db.prepare('SELECT * FROM entities ORDER BY id DESC').all(), ['attributes']),
    claims: deserializeRows(db.prepare('SELECT * FROM claims ORDER BY id DESC').all(), ['attributes']),
    observations: deserializeRows(db.prepare('SELECT * FROM observations ORDER BY id DESC').all(), ['attributes']),
    relationships: deserializeRows(db.prepare('SELECT * FROM relationships ORDER BY id DESC').all(), ['attributes']),
    chunks: deserializeRows(db.prepare('SELECT * FROM chunks ORDER BY id DESC').all(), ['location_metadata'])
  };
}

function searchRecords(query) {
  const q = `%${String(query || '').trim()}%`;
  if (!q || q === '%%') {
    return listRecords();
  }

  return {
    sources: deserializeRows(db.prepare(`SELECT * FROM sources WHERE title LIKE ? OR type LIKE ? OR uri LIKE ? ORDER BY id DESC`).all(q, q, q), ['metadata']),
    entities: deserializeRows(db.prepare(`SELECT * FROM entities WHERE canonical_name LIKE ? OR type LIKE ? ORDER BY id DESC`).all(q, q), ['attributes']),
    claims: deserializeRows(db.prepare(`SELECT * FROM claims WHERE subject LIKE ? OR predicate LIKE ? OR object LIKE ? ORDER BY id DESC`).all(q, q, q), ['attributes']),
    observations: deserializeRows(db.prepare(`SELECT * FROM observations WHERE subject LIKE ? OR value LIKE ? OR unit LIKE ? ORDER BY id DESC`).all(q, q, q), ['attributes']),
    relationships: deserializeRows(db.prepare(`SELECT * FROM relationships WHERE source_entity LIKE ? OR target_entity LIKE ? OR relationship_type LIKE ? ORDER BY id DESC`).all(q, q, q), ['attributes'])
  };
}

module.exports = {
  db,
  projectRoot,
  getArtifactByHash,
  listSources,
  listArtifacts,
  listRecords,
  searchRecords,
  insertSource,
  insertArtifact,
  insertContentRepresentation,
  insertChunk,
  insertExtraction,
  insertEntity,
  insertClaim,
  insertObservation,
  insertRelationship,
  insertEvidence,
  insertScope,
  deserializeRows
};
