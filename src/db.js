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

  CREATE TABLE IF NOT EXISTS canonical_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    jurisdiction_id INTEGER,
    valid_from TEXT,
    valid_to TEXT,
    attributes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (type, canonical_name)
  );

  CREATE TABLE IF NOT EXISTS entity_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_entity_id INTEGER NOT NULL,
    alias TEXT NOT NULL,
    alias_type TEXT DEFAULT 'alias',
    attributes TEXT,
    UNIQUE (canonical_entity_id, alias),
    FOREIGN KEY (canonical_entity_id) REFERENCES canonical_entities(id)
  );

  CREATE TABLE IF NOT EXISTS entity_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id INTEGER NOT NULL,
    entity_id INTEGER,
    canonical_entity_id INTEGER NOT NULL,
    mention_text TEXT NOT NULL,
    confidence REAL,
    attributes TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id),
    FOREIGN KEY (entity_id) REFERENCES entities(id),
    FOREIGN KEY (canonical_entity_id) REFERENCES canonical_entities(id)
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

  CREATE TABLE IF NOT EXISTS contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jurisdiction_id INTEGER,
    temporal_scope_id INTEGER,
    population TEXT,
    conditions TEXT,
    definitions TEXT,
    metadata TEXT,
    FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id),
    FOREIGN KEY (temporal_scope_id) REFERENCES temporal_scopes(id)
  );

  CREATE TABLE IF NOT EXISTS propositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposition_type TEXT NOT NULL DEFAULT 'proposition',
    subject_entity_id INTEGER,
    subject_text TEXT,
    predicate TEXT NOT NULL,
    object_entity_id INTEGER,
    object_text TEXT,
    context_id INTEGER,
    attributes TEXT,
    FOREIGN KEY (subject_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (object_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS canonical_propositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    base_fingerprint TEXT NOT NULL,
    representative_proposition_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    attributes TEXT,
    FOREIGN KEY (representative_proposition_id) REFERENCES propositions(id)
  );

  CREATE TABLE IF NOT EXISTS proposition_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_proposition_id INTEGER NOT NULL,
    proposition_id INTEGER NOT NULL,
    resolution_type TEXT NOT NULL,
    confidence REAL,
    metadata TEXT,
    UNIQUE (canonical_proposition_id, proposition_id, resolution_type),
    FOREIGN KEY (canonical_proposition_id) REFERENCES canonical_propositions(id),
    FOREIGN KEY (proposition_id) REFERENCES propositions(id)
  );

  CREATE TABLE IF NOT EXISTS states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_entity_id INTEGER,
    state_type TEXT NOT NULL,
    value TEXT,
    unit TEXT,
    observed_at TEXT,
    valid_from TEXT,
    valid_to TEXT,
    measurement_period TEXT,
    temporal_scope_id INTEGER,
    context_id INTEGER,
    attributes TEXT,
    FOREIGN KEY (subject_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    subject_entity_id INTEGER,
    object_entity_id INTEGER,
    occurred_at TEXT,
    context_id INTEGER,
    attributes TEXT,
    FOREIGN KEY (subject_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (object_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_type TEXT NOT NULL,
    modality TEXT NOT NULL DEFAULT 'required',
    subject_entity_id INTEGER,
    predicate TEXT,
    object_entity_id INTEGER,
    conditions TEXT,
    context_id INTEGER,
    effective_from TEXT,
    effective_to TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    attributes TEXT,
    FOREIGN KEY (subject_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (object_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS mechanisms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mechanism_type TEXT NOT NULL,
    source_entity_id INTEGER,
    target_entity_id INTEGER,
    direction TEXT,
    conditions TEXT,
    context_id INTEGER,
    confidence REAL,
    magnitude REAL,
    magnitude_unit TEXT,
    lag REAL,
    lag_unit TEXT,
    strength REAL,
    polarity TEXT,
    certainty TEXT,
    mechanism_description TEXT,
    assumptions TEXT,
    attributes TEXT,
    FOREIGN KEY (source_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (target_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS processes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    context_id INTEGER,
    attributes TEXT,
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS process_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    step_type TEXT NOT NULL DEFAULT 'step',
    name TEXT NOT NULL,
    actor_entity_id INTEGER,
    context_id INTEGER,
    attributes TEXT,
    UNIQUE (process_id, sequence),
    FOREIGN KEY (process_id) REFERENCES processes(id),
    FOREIGN KEY (actor_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS process_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id INTEGER NOT NULL,
    from_step_id INTEGER NOT NULL,
    to_step_id INTEGER NOT NULL,
    condition TEXT,
    attributes TEXT,
    UNIQUE (process_id, from_step_id, to_step_id),
    FOREIGN KEY (process_id) REFERENCES processes(id),
    FOREIGN KEY (from_step_id) REFERENCES process_steps(id),
    FOREIGN KEY (to_step_id) REFERENCES process_steps(id)
  );

  CREATE TABLE IF NOT EXISTS resource_flows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id INTEGER,
    source_entity_id INTEGER,
    target_entity_id INTEGER,
    resource_type TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    context_id INTEGER,
    attributes TEXT,
    FOREIGN KEY (process_id) REFERENCES processes(id),
    FOREIGN KEY (source_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (target_entity_id) REFERENCES canonical_entities(id),
    FOREIGN KEY (context_id) REFERENCES contexts(id)
  );

  CREATE TABLE IF NOT EXISTS canonical_mechanisms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    base_fingerprint TEXT NOT NULL,
    representative_mechanism_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate',
    attributes TEXT,
    FOREIGN KEY (representative_mechanism_id) REFERENCES mechanisms(id)
  );

  CREATE TABLE IF NOT EXISTS mechanism_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_mechanism_id INTEGER NOT NULL,
    mechanism_id INTEGER NOT NULL,
    resolution_type TEXT NOT NULL,
    confidence REAL,
    metadata TEXT,
    UNIQUE (canonical_mechanism_id, mechanism_id, resolution_type),
    FOREIGN KEY (canonical_mechanism_id) REFERENCES canonical_mechanisms(id),
    FOREIGN KEY (mechanism_id) REFERENCES mechanisms(id)
  );

  CREATE TABLE IF NOT EXISTS rule_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    field TEXT NOT NULL,
    operator TEXT NOT NULL,
    value TEXT,
    unit TEXT,
    logical_group TEXT DEFAULT 'all',
    metadata TEXT,
    FOREIGN KEY (rule_id) REFERENCES rules(id)
  );

  CREATE TABLE IF NOT EXISTS provenance_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    evidence_id INTEGER NOT NULL,
    extraction_id INTEGER,
    transformation TEXT,
    metadata TEXT,
    UNIQUE (target_type, target_id, evidence_id),
    FOREIGN KEY (evidence_id) REFERENCES evidence(id),
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS source_assertions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    artifact_id INTEGER,
    extraction_id INTEGER,
    claim_id INTEGER,
    proposition_id INTEGER,
    assertion_type TEXT NOT NULL DEFAULT 'source_assertion',
    subject TEXT,
    predicate TEXT,
    object TEXT,
    assertion_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unassessed',
    attributes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id),
    FOREIGN KEY (artifact_id) REFERENCES raw_artifacts(id),
    FOREIGN KEY (extraction_id) REFERENCES extractions(id),
    FOREIGN KEY (claim_id) REFERENCES claims(id)
    ,FOREIGN KEY (proposition_id) REFERENCES propositions(id)
  );

  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    confidence REAL,
    rationale TEXT,
    reviewer TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS assertion_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_assertion_id INTEGER NOT NULL,
    target_assertion_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    metadata TEXT,
    UNIQUE (source_assertion_id, target_assertion_id, relation_type),
    FOREIGN KEY (source_assertion_id) REFERENCES source_assertions(id),
    FOREIGN KEY (target_assertion_id) REFERENCES source_assertions(id)
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
    subject_entity_id INTEGER,
    object_entity_id INTEGER,
    relationship_type TEXT,
    source_entity TEXT,
    target_entity TEXT,
    temporal_scope_id INTEGER,
    jurisdiction_id INTEGER,
    attributes TEXT,
    FOREIGN KEY (extraction_id) REFERENCES extractions(id)
  );

  CREATE TABLE IF NOT EXISTS jurisdictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    metadata TEXT,
    UNIQUE (type, name),
    FOREIGN KEY (parent_id) REFERENCES jurisdictions(id)
  );

  CREATE TABLE IF NOT EXISTS temporal_scopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    published_at TEXT,
    retrieved_at TEXT,
    effective_from TEXT,
    effective_to TEXT,
    observed_at TEXT,
    valid_from TEXT,
    valid_to TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS entity_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER,
    name TEXT NOT NULL,
    parent_type_id INTEGER,
    constraints TEXT,
    metadata TEXT,
    UNIQUE (domain_id, name),
    FOREIGN KEY (domain_id) REFERENCES domains(id),
    FOREIGN KEY (parent_type_id) REFERENCES entity_types(id)
  );

  CREATE TABLE IF NOT EXISTS relationship_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER,
    name TEXT NOT NULL,
    inverse_name TEXT,
    constraints TEXT,
    metadata TEXT,
    UNIQUE (domain_id, name),
    FOREIGN KEY (domain_id) REFERENCES domains(id)
  );

  CREATE TABLE IF NOT EXISTS taxonomy_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER,
    parent_id INTEGER,
    name TEXT NOT NULL,
    node_type TEXT,
    metadata TEXT,
    UNIQUE (domain_id, parent_id, name),
    FOREIGN KEY (domain_id) REFERENCES domains(id),
    FOREIGN KEY (parent_id) REFERENCES taxonomy_nodes(id)
  );

  CREATE TABLE IF NOT EXISTS taxonomy_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_node_id INTEGER NOT NULL,
    target_node_id INTEGER NOT NULL,
    edge_type TEXT NOT NULL,
    metadata TEXT,
    UNIQUE (source_node_id, target_node_id, edge_type),
    FOREIGN KEY (source_node_id) REFERENCES taxonomy_nodes(id),
    FOREIGN KEY (target_node_id) REFERENCES taxonomy_nodes(id)
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
    jurisdiction_id INTEGER,
    temporal_scope_id INTEGER,
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

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('relationships', 'subject_entity_id', 'INTEGER');
ensureColumn('relationships', 'object_entity_id', 'INTEGER');
ensureColumn('relationships', 'temporal_scope_id', 'INTEGER');
ensureColumn('relationships', 'jurisdiction_id', 'INTEGER');
ensureColumn('scopes', 'jurisdiction_id', 'INTEGER');
ensureColumn('scopes', 'temporal_scope_id', 'INTEGER');
ensureColumn('source_assertions', 'proposition_id', 'INTEGER');
ensureColumn('states', 'valid_from', 'TEXT');
ensureColumn('states', 'valid_to', 'TEXT');
ensureColumn('states', 'measurement_period', 'TEXT');
ensureColumn('states', 'temporal_scope_id', 'INTEGER');
ensureColumn('mechanisms', 'magnitude', 'REAL');
ensureColumn('mechanisms', 'magnitude_unit', 'TEXT');
ensureColumn('mechanisms', 'lag', 'REAL');
ensureColumn('mechanisms', 'lag_unit', 'TEXT');
ensureColumn('mechanisms', 'strength', 'REAL');
ensureColumn('mechanisms', 'polarity', 'TEXT');
ensureColumn('mechanisms', 'certainty', 'TEXT');
ensureColumn('mechanisms', 'mechanism_description', 'TEXT');
ensureColumn('mechanisms', 'assumptions', 'TEXT');

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

function seedOntologyDefinitions() {
  const insertDomain = db.prepare(`
    INSERT INTO domains (name, description, metadata)
    VALUES (@name, @description, @metadata)
    ON CONFLICT(name) DO UPDATE SET description = excluded.description
  `);
  insertDomain.run({
    name: 'C3 Core',
    description: 'Cross-domain types and predicates shared by the C3 information foundation.',
    metadata: serializeMetadata({ managed: true })
  });
  const domainRow = db.prepare('SELECT * FROM domains WHERE name = ?').get('C3 Core');

  const entityTypes = [
    ['Entity', null], ['Person', 'Entity'], ['Organization', 'Entity'], ['Agency', 'Organization'],
    ['Company', 'Organization'], ['Program', 'Entity'], ['Institution', 'Organization'], ['Court', 'Institution'],
    ['Government', 'Organization'], ['Population', 'Entity'], ['Rule', 'Entity'], ['Law', 'Rule'],
    ['Regulation', 'Rule'], ['Policy', 'Rule'], ['Requirement', 'Rule'], ['Procedure', 'Rule'],
    ['Process', 'Entity'], ['Workflow', 'Process'], ['Decision', 'Process'], ['Resource', 'Entity'],
    ['Service', 'Resource'], ['Measurement', 'Entity'], ['Statistic', 'Measurement'], ['Outcome', 'Measurement'],
    ['Event', 'Entity'], ['Place', 'Entity'], ['Jurisdiction', 'Place']
  ];
  const insertEntityType = db.prepare(`
    INSERT INTO entity_types (domain_id, name, parent_type_id, metadata)
    VALUES (@domain_id, @name, @parent_type_id, @metadata)
    ON CONFLICT(domain_id, name) DO UPDATE SET parent_type_id = excluded.parent_type_id
  `);
  for (const [name, parentName] of entityTypes) {
    const parent = parentName ? db.prepare('SELECT id FROM entity_types WHERE domain_id = ? AND name = ?').get(domainRow.id, parentName) : null;
    insertEntityType.run({ domain_id: domainRow.id, name, parent_type_id: parent ? parent.id : null, metadata: serializeMetadata({ managed: true }) });
  }

  const relationshipTypes = [
    ['ADMINISTERS', 'ADMINISTERED_BY'], ['FUNDS', 'FUNDED_BY'], ['REGULATES', 'REGULATED_BY'],
    ['GOVERNS', 'GOVERNED_BY'], ['REQUIRES', 'REQUIRED_BY'], ['DEPENDS_ON', 'REQUIRED_BY'],
    ['ELIGIBLE_FOR', 'HAS_ELIGIBILITY'], ['SERVES', 'SERVED_BY'], ['AFFECTS', 'AFFECTED_BY'],
    ['LOCATED_IN', 'CONTAINS'], ['OPERATES_IN', 'HOSTS'], ['CREATED_BY', 'CREATES'],
    ['AUTHORIZED_BY', 'AUTHORIZES'], ['SUPERSEDES', 'SUPERSEDED_BY'], ['AMENDS', 'AMENDED_BY'],
    ['IMPLEMENTS', 'IMPLEMENTED_BY'], ['ENFORCES', 'ENFORCED_BY'], ['REPORTS', 'REPORTED_BY'],
    ['MEASURES', 'MEASURED_BY'], ['CAUSES', 'CAUSED_BY'], ['CORRELATES_WITH', 'CORRELATES_WITH'],
    ['CONTRADICTS', 'CONTRADICTS'], ['SUPPORTS', 'SUPPORTED_BY']
  ];
  const insertRelationshipType = db.prepare(`
    INSERT INTO relationship_types (domain_id, name, inverse_name, metadata)
    VALUES (@domain_id, @name, @inverse_name, @metadata)
    ON CONFLICT(domain_id, name) DO UPDATE SET inverse_name = excluded.inverse_name
  `);
  for (const [name, inverseName] of relationshipTypes) {
    insertRelationshipType.run({ domain_id: domainRow.id, name, inverse_name: inverseName, metadata: serializeMetadata({ managed: true }) });
  }
}

seedOntologyDefinitions();

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

function insertCanonicalEntity({ type, canonical_name, jurisdiction_id = null, valid_from = null, valid_to = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO canonical_entities (type, canonical_name, jurisdiction_id, valid_from, valid_to, attributes)
    VALUES (@type, @canonical_name, @jurisdiction_id, @valid_from, @valid_to, @attributes)
    ON CONFLICT(type, canonical_name) DO UPDATE SET
      jurisdiction_id = COALESCE(excluded.jurisdiction_id, canonical_entities.jurisdiction_id),
      valid_from = COALESCE(excluded.valid_from, canonical_entities.valid_from),
      valid_to = COALESCE(excluded.valid_to, canonical_entities.valid_to),
      attributes = COALESCE(excluded.attributes, canonical_entities.attributes)
  `);
  stmt.run({
    type,
    canonical_name,
    jurisdiction_id,
    valid_from,
    valid_to,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM canonical_entities WHERE type = ? AND canonical_name = ?').get(type, canonical_name);
}

function insertEntityAlias({ canonical_entity_id, alias, alias_type = 'alias', attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO entity_aliases (canonical_entity_id, alias, alias_type, attributes)
    VALUES (@canonical_entity_id, @alias, @alias_type, @attributes)
    ON CONFLICT(canonical_entity_id, alias) DO UPDATE SET
      alias_type = excluded.alias_type,
      attributes = COALESCE(excluded.attributes, entity_aliases.attributes)
  `);
  stmt.run({ canonical_entity_id, alias, alias_type, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM entity_aliases WHERE canonical_entity_id = ? AND alias = ?').get(canonical_entity_id, alias);
}

function insertEntityMention({ extraction_id, entity_id = null, canonical_entity_id, mention_text, confidence = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO entity_mentions (extraction_id, entity_id, canonical_entity_id, mention_text, confidence, attributes)
    VALUES (@extraction_id, @entity_id, @canonical_entity_id, @mention_text, @confidence, @attributes)
  `);
  const result = stmt.run({
    extraction_id,
    entity_id,
    canonical_entity_id,
    mention_text,
    confidence,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM entity_mentions WHERE id = ?').get(result.lastInsertRowid);
}

function insertJurisdiction({ parent_id = null, type = 'JURISDICTION', name, code = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO jurisdictions (parent_id, type, name, code, metadata)
    VALUES (@parent_id, @type, @name, @code, @metadata)
    ON CONFLICT(type, name) DO UPDATE SET parent_id = COALESCE(excluded.parent_id, jurisdictions.parent_id), code = COALESCE(excluded.code, jurisdictions.code)
  `);
  stmt.run({ parent_id, type, name, code, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM jurisdictions WHERE type = ? AND name = ?').get(type, name);
}

function insertTemporalScope({ published_at = null, retrieved_at = null, effective_from = null, effective_to = null, observed_at = null, valid_from = null, valid_to = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO temporal_scopes (published_at, retrieved_at, effective_from, effective_to, observed_at, valid_from, valid_to, metadata)
    VALUES (@published_at, @retrieved_at, @effective_from, @effective_to, @observed_at, @valid_from, @valid_to, @metadata)
  `);
  const result = stmt.run({ published_at, retrieved_at, effective_from, effective_to, observed_at, valid_from, valid_to, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM temporal_scopes WHERE id = ?').get(result.lastInsertRowid);
}

function insertContext({ jurisdiction_id = null, temporal_scope_id = null, population = null, conditions = null, definitions = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO contexts (jurisdiction_id, temporal_scope_id, population, conditions, definitions, metadata)
    VALUES (@jurisdiction_id, @temporal_scope_id, @population, @conditions, @definitions, @metadata)
  `);
  const result = stmt.run({ jurisdiction_id, temporal_scope_id, population, conditions, definitions, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM contexts WHERE id = ?').get(result.lastInsertRowid);
}

function insertProposition({ proposition_type = 'proposition', subject_entity_id = null, subject_text = null, predicate, object_entity_id = null, object_text = null, context_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO propositions (proposition_type, subject_entity_id, subject_text, predicate, object_entity_id, object_text, context_id, attributes)
    VALUES (@proposition_type, @subject_entity_id, @subject_text, @predicate, @object_entity_id, @object_text, @context_id, @attributes)
  `);
  const result = stmt.run({ proposition_type, subject_entity_id, subject_text, predicate, object_entity_id, object_text, context_id, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM propositions WHERE id = ?').get(result.lastInsertRowid);
}

function insertCanonicalProposition({ fingerprint, base_fingerprint, representative_proposition_id, status = 'candidate', attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO canonical_propositions (fingerprint, base_fingerprint, representative_proposition_id, status, attributes)
    VALUES (@fingerprint, @base_fingerprint, @representative_proposition_id, @status, @attributes)
    ON CONFLICT(fingerprint) DO UPDATE SET status = excluded.status
  `);
  stmt.run({ fingerprint, base_fingerprint, representative_proposition_id, status, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM canonical_propositions WHERE fingerprint = ?').get(fingerprint);
}

function insertPropositionResolution({ canonical_proposition_id, proposition_id, resolution_type, confidence = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO proposition_resolutions (canonical_proposition_id, proposition_id, resolution_type, confidence, metadata)
    VALUES (@canonical_proposition_id, @proposition_id, @resolution_type, @confidence, @metadata)
    ON CONFLICT(canonical_proposition_id, proposition_id, resolution_type) DO UPDATE SET confidence = excluded.confidence
  `);
  stmt.run({ canonical_proposition_id, proposition_id, resolution_type, confidence, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM proposition_resolutions WHERE canonical_proposition_id = ? AND proposition_id = ? AND resolution_type = ?').get(canonical_proposition_id, proposition_id, resolution_type);
}

function insertState({ subject_entity_id = null, state_type, value = null, unit = null, observed_at = null, valid_from = null, valid_to = null, measurement_period = null, temporal_scope_id = null, context_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO states (subject_entity_id, state_type, value, unit, observed_at, valid_from, valid_to, measurement_period, temporal_scope_id, context_id, attributes)
    VALUES (@subject_entity_id, @state_type, @value, @unit, @observed_at, @valid_from, @valid_to, @measurement_period, @temporal_scope_id, @context_id, @attributes)
  `);
  const result = stmt.run({ subject_entity_id, state_type, value, unit, observed_at, valid_from, valid_to, measurement_period, temporal_scope_id, context_id, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM states WHERE id = ?').get(result.lastInsertRowid);
}

function insertEvent({ event_type, subject_entity_id = null, object_entity_id = null, occurred_at = null, context_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO events (event_type, subject_entity_id, object_entity_id, occurred_at, context_id, attributes)
    VALUES (@event_type, @subject_entity_id, @object_entity_id, @occurred_at, @context_id, @attributes)
  `);
  const result = stmt.run({ event_type, subject_entity_id, object_entity_id, occurred_at, context_id, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
}

function insertRule({ rule_type, modality = 'required', subject_entity_id = null, predicate = null, object_entity_id = null, conditions = null, context_id = null, effective_from = null, effective_to = null, status = 'proposed', attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO rules (rule_type, modality, subject_entity_id, predicate, object_entity_id, conditions, context_id, effective_from, effective_to, status, attributes)
    VALUES (@rule_type, @modality, @subject_entity_id, @predicate, @object_entity_id, @conditions, @context_id, @effective_from, @effective_to, @status, @attributes)
  `);
  const result = stmt.run({ rule_type, modality, subject_entity_id, predicate, object_entity_id, conditions, context_id, effective_from, effective_to, status, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM rules WHERE id = ?').get(result.lastInsertRowid);
}

function insertMechanism({ mechanism_type, source_entity_id = null, target_entity_id = null, direction = null, conditions = null, context_id = null, confidence = null, magnitude = null, magnitude_unit = null, lag = null, lag_unit = null, strength = null, polarity = null, certainty = null, mechanism_description = null, assumptions = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO mechanisms (mechanism_type, source_entity_id, target_entity_id, direction, conditions, context_id, confidence, magnitude, magnitude_unit, lag, lag_unit, strength, polarity, certainty, mechanism_description, assumptions, attributes)
    VALUES (@mechanism_type, @source_entity_id, @target_entity_id, @direction, @conditions, @context_id, @confidence, @magnitude, @magnitude_unit, @lag, @lag_unit, @strength, @polarity, @certainty, @mechanism_description, @assumptions, @attributes)
  `);
  const result = stmt.run({ mechanism_type, source_entity_id, target_entity_id, direction, conditions, context_id, confidence, magnitude, magnitude_unit, lag, lag_unit, strength, polarity, certainty, mechanism_description, assumptions, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM mechanisms WHERE id = ?').get(result.lastInsertRowid);
}

function insertCanonicalMechanism({ fingerprint, base_fingerprint, representative_mechanism_id, status = 'candidate', attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO canonical_mechanisms (fingerprint, base_fingerprint, representative_mechanism_id, status, attributes)
    VALUES (@fingerprint, @base_fingerprint, @representative_mechanism_id, @status, @attributes)
    ON CONFLICT(fingerprint) DO UPDATE SET status = excluded.status
  `);
  stmt.run({ fingerprint, base_fingerprint, representative_mechanism_id, status, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM canonical_mechanisms WHERE fingerprint = ?').get(fingerprint);
}

function insertMechanismResolution({ canonical_mechanism_id, mechanism_id, resolution_type, confidence = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO mechanism_resolutions (canonical_mechanism_id, mechanism_id, resolution_type, confidence, metadata)
    VALUES (@canonical_mechanism_id, @mechanism_id, @resolution_type, @confidence, @metadata)
    ON CONFLICT(canonical_mechanism_id, mechanism_id, resolution_type) DO UPDATE SET confidence = excluded.confidence
  `);
  stmt.run({ canonical_mechanism_id, mechanism_id, resolution_type, confidence, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM mechanism_resolutions WHERE canonical_mechanism_id = ? AND mechanism_id = ? AND resolution_type = ?').get(canonical_mechanism_id, mechanism_id, resolution_type);
}

function insertProcess({ process_type, name, status = 'candidate', context_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO processes (process_type, name, status, context_id, attributes)
    VALUES (@process_type, @name, @status, @context_id, @attributes)
  `);
  const result = stmt.run({ process_type, name, status, context_id, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM processes WHERE id = ?').get(result.lastInsertRowid);
}

function insertProcessStep({ process_id, sequence, step_type = 'step', name, actor_entity_id = null, context_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO process_steps (process_id, sequence, step_type, name, actor_entity_id, context_id, attributes)
    VALUES (@process_id, @sequence, @step_type, @name, @actor_entity_id, @context_id, @attributes)
    ON CONFLICT(process_id, sequence) DO UPDATE SET name = excluded.name, attributes = excluded.attributes
  `);
  stmt.run({ process_id, sequence, step_type, name, actor_entity_id, context_id, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM process_steps WHERE process_id = ? AND sequence = ?').get(process_id, sequence);
}

function insertProcessTransition({ process_id, from_step_id, to_step_id, condition = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO process_transitions (process_id, from_step_id, to_step_id, condition, attributes)
    VALUES (@process_id, @from_step_id, @to_step_id, @condition, @attributes)
    ON CONFLICT(process_id, from_step_id, to_step_id) DO UPDATE SET condition = excluded.condition, attributes = excluded.attributes
  `);
  stmt.run({ process_id, from_step_id, to_step_id, condition, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM process_transitions WHERE process_id = ? AND from_step_id = ? AND to_step_id = ?').get(process_id, from_step_id, to_step_id);
}

function insertResourceFlow({ process_id = null, source_entity_id = null, target_entity_id = null, resource_type, quantity = null, unit = null, context_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO resource_flows (process_id, source_entity_id, target_entity_id, resource_type, quantity, unit, context_id, attributes)
    VALUES (@process_id, @source_entity_id, @target_entity_id, @resource_type, @quantity, @unit, @context_id, @attributes)
  `);
  const result = stmt.run({ process_id, source_entity_id, target_entity_id, resource_type, quantity, unit, context_id, attributes: serializeMetadata(attributes) });
  return db.prepare('SELECT * FROM resource_flows WHERE id = ?').get(result.lastInsertRowid);
}

function insertRuleCondition({ rule_id, field, operator, value = null, unit = null, logical_group = 'all', metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO rule_conditions (rule_id, field, operator, value, unit, logical_group, metadata)
    VALUES (@rule_id, @field, @operator, @value, @unit, @logical_group, @metadata)
  `);
  const result = stmt.run({ rule_id, field, operator, value, unit, logical_group, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM rule_conditions WHERE id = ?').get(result.lastInsertRowid);
}

function insertProvenanceLink({ target_type, target_id, evidence_id, extraction_id = null, transformation = 'derived_from_source_assertion', metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO provenance_links (target_type, target_id, evidence_id, extraction_id, transformation, metadata)
    VALUES (@target_type, @target_id, @evidence_id, @extraction_id, @transformation, @metadata)
    ON CONFLICT(target_type, target_id, evidence_id) DO UPDATE SET metadata = excluded.metadata
  `);
  stmt.run({ target_type, target_id, evidence_id, extraction_id, transformation, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM provenance_links WHERE target_type = ? AND target_id = ? AND evidence_id = ?').get(target_type, target_id, evidence_id);
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

function insertSourceAssertion({ source_id, artifact_id = null, extraction_id = null, claim_id = null, proposition_id = null, assertion_type = 'source_assertion', subject = null, predicate = null, object = null, assertion_text, status = 'unassessed', attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO source_assertions (source_id, artifact_id, extraction_id, claim_id, proposition_id, assertion_type, subject, predicate, object, assertion_text, status, attributes)
    VALUES (@source_id, @artifact_id, @extraction_id, @claim_id, @proposition_id, @assertion_type, @subject, @predicate, @object, @assertion_text, @status, @attributes)
  `);
  const result = stmt.run({
    source_id,
    artifact_id,
    extraction_id,
    claim_id,
    proposition_id,
    assertion_type,
    subject,
    predicate,
    object,
    assertion_text,
    status,
    attributes: serializeMetadata(attributes)
  });
  return db.prepare('SELECT * FROM source_assertions WHERE id = ?').get(result.lastInsertRowid);
}

function insertAssessment({ target_type, target_id, status, confidence = null, rationale = null, reviewer = null, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO assessments (target_type, target_id, status, confidence, rationale, reviewer, metadata)
    VALUES (@target_type, @target_id, @status, @confidence, @rationale, @reviewer, @metadata)
  `);
  const result = stmt.run({
    target_type,
    target_id,
    status,
    confidence,
    rationale,
    reviewer,
    metadata: serializeMetadata(metadata)
  });
  return db.prepare('SELECT * FROM assessments WHERE id = ?').get(result.lastInsertRowid);
}

function insertAssertionRelation({ source_assertion_id, target_assertion_id, relation_type, metadata = {} }) {
  const stmt = db.prepare(`
    INSERT INTO assertion_relations (source_assertion_id, target_assertion_id, relation_type, metadata)
    VALUES (@source_assertion_id, @target_assertion_id, @relation_type, @metadata)
    ON CONFLICT(source_assertion_id, target_assertion_id, relation_type) DO UPDATE SET metadata = excluded.metadata
  `);
  stmt.run({ source_assertion_id, target_assertion_id, relation_type, metadata: serializeMetadata(metadata) });
  return db.prepare('SELECT * FROM assertion_relations WHERE source_assertion_id = ? AND target_assertion_id = ? AND relation_type = ?').get(source_assertion_id, target_assertion_id, relation_type);
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

function insertRelationship({ extraction_id, subject_entity_id = null, object_entity_id = null, relationship_type, source_entity, target_entity, temporal_scope_id = null, jurisdiction_id = null, attributes = {} }) {
  const stmt = db.prepare(`
    INSERT INTO relationships (extraction_id, subject_entity_id, object_entity_id, relationship_type, source_entity, target_entity, temporal_scope_id, jurisdiction_id, attributes)
    VALUES (@extraction_id, @subject_entity_id, @object_entity_id, @relationship_type, @source_entity, @target_entity, @temporal_scope_id, @jurisdiction_id, @attributes)
  `);
  const result = stmt.run({
    extraction_id,
    subject_entity_id,
    object_entity_id,
    relationship_type,
    source_entity,
    target_entity,
    temporal_scope_id,
    jurisdiction_id,
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

function listOntologyDefinitions() {
  return {
    domains: deserializeRows(db.prepare('SELECT * FROM domains ORDER BY name').all(), ['metadata']),
    entity_types: deserializeRows(db.prepare('SELECT * FROM entity_types ORDER BY name').all(), ['constraints', 'metadata']),
    relationship_types: deserializeRows(db.prepare('SELECT * FROM relationship_types ORDER BY name').all(), ['constraints', 'metadata']),
    taxonomy_nodes: deserializeRows(db.prepare('SELECT * FROM taxonomy_nodes ORDER BY name').all(), ['metadata']),
    taxonomy_edges: deserializeRows(db.prepare('SELECT * FROM taxonomy_edges ORDER BY id').all(), ['metadata'])
  };
}

function listRecords() {
  return {
    sources: listSources(),
    artifacts: listArtifacts(),
    entities: deserializeRows(db.prepare('SELECT * FROM entities ORDER BY id DESC').all(), ['attributes']),
    canonical_entities: deserializeRows(db.prepare('SELECT * FROM canonical_entities ORDER BY id DESC').all(), ['attributes']),
    entity_mentions: deserializeRows(db.prepare('SELECT * FROM entity_mentions ORDER BY id DESC').all(), ['attributes']),
    contexts: deserializeRows(db.prepare('SELECT * FROM contexts ORDER BY id DESC').all(), ['metadata']),
    propositions: deserializeRows(db.prepare('SELECT * FROM propositions ORDER BY id DESC').all(), ['attributes']),
    canonical_propositions: deserializeRows(db.prepare('SELECT * FROM canonical_propositions ORDER BY id DESC').all(), ['attributes']),
    proposition_resolutions: deserializeRows(db.prepare('SELECT * FROM proposition_resolutions ORDER BY id DESC').all(), ['metadata']),
    states: deserializeRows(db.prepare('SELECT * FROM states ORDER BY id DESC').all(), ['attributes']),
    events: deserializeRows(db.prepare('SELECT * FROM events ORDER BY id DESC').all(), ['attributes']),
    rules: deserializeRows(db.prepare('SELECT * FROM rules ORDER BY id DESC').all(), ['attributes']),
    mechanisms: deserializeRows(db.prepare('SELECT * FROM mechanisms ORDER BY id DESC').all(), ['attributes']),
    canonical_mechanisms: deserializeRows(db.prepare('SELECT * FROM canonical_mechanisms ORDER BY id DESC').all(), ['attributes']),
    mechanism_resolutions: deserializeRows(db.prepare('SELECT * FROM mechanism_resolutions ORDER BY id DESC').all(), ['metadata']),
    processes: deserializeRows(db.prepare('SELECT * FROM processes ORDER BY id DESC').all(), ['attributes']),
    process_steps: deserializeRows(db.prepare('SELECT * FROM process_steps ORDER BY id DESC').all(), ['attributes']),
    process_transitions: deserializeRows(db.prepare('SELECT * FROM process_transitions ORDER BY id DESC').all(), ['attributes']),
    resource_flows: deserializeRows(db.prepare('SELECT * FROM resource_flows ORDER BY id DESC').all(), ['attributes']),
    rule_conditions: deserializeRows(db.prepare('SELECT * FROM rule_conditions ORDER BY id DESC').all(), ['metadata']),
    provenance_links: deserializeRows(db.prepare('SELECT * FROM provenance_links ORDER BY id DESC').all(), ['metadata']),
    claims: deserializeRows(db.prepare('SELECT * FROM claims ORDER BY id DESC').all(), ['attributes']),
    observations: deserializeRows(db.prepare('SELECT * FROM observations ORDER BY id DESC').all(), ['attributes']),
    relationships: deserializeRows(db.prepare('SELECT * FROM relationships ORDER BY id DESC').all(), ['attributes']),
    source_assertions: deserializeRows(db.prepare('SELECT * FROM source_assertions ORDER BY id DESC').all(), ['attributes']),
    assessments: deserializeRows(db.prepare('SELECT * FROM assessments ORDER BY id DESC').all(), ['metadata']),
    assertion_relations: deserializeRows(db.prepare('SELECT * FROM assertion_relations ORDER BY id DESC').all(), ['metadata']),
    chunks: deserializeRows(db.prepare('SELECT * FROM chunks ORDER BY id DESC').all(), ['location_metadata']),
    evidence: deserializeRows(db.prepare('SELECT * FROM evidence ORDER BY id DESC').all(), ['metadata'])
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
  listOntologyDefinitions,
  listRecords,
  searchRecords,
  insertSource,
  insertArtifact,
  insertContentRepresentation,
  insertChunk,
  insertExtraction,
  insertEntity,
  insertCanonicalEntity,
  insertEntityAlias,
  insertEntityMention,
  insertJurisdiction,
  insertTemporalScope,
  insertContext,
  insertProposition,
  insertCanonicalProposition,
  insertPropositionResolution,
  insertState,
  insertEvent,
  insertRule,
  insertMechanism,
  insertCanonicalMechanism,
  insertMechanismResolution,
  insertProcess,
  insertProcessStep,
  insertProcessTransition,
  insertResourceFlow,
  insertRuleCondition,
  insertProvenanceLink,
  insertClaim,
  insertSourceAssertion,
  insertAssessment,
  insertAssertionRelation,
  insertObservation,
  insertRelationship,
  insertEvidence,
  insertScope,
  deserializeRows
};
