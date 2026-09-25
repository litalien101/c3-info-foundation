const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');

const {
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
  insertState,
  insertEvent,
  insertRule,
  insertMechanism,
  insertClaim,
  insertSourceAssertion,
  insertAssessment,
  insertAssertionRelation,
  insertObservation,
  insertRelationship,
  insertEvidence,
  insertScope
} = require('./db');
const { parseDocument, buildAiContextBundle, buildKnowledgeBaseGraph, extractStructuredContent, hashContent } = require('./ingestion');

const app = express();
const uploadDir = path.join(projectRoot, 'storage', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(projectRoot, 'public')));

function inferMimeTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown'
  };
  return map[ext] || 'application/octet-stream';
}

function buildPublicContext(data) {
  return {
    ...data,
    generated_at: new Date().toISOString()
  };
}

function findTextSpan(text, value, startAt = 0) {
  const source = String(text || '');
  const needle = String(value || '').trim();
  if (!needle) return null;
  const start = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), startAt);
  if (start < 0) return null;
  return {
    character_start: start,
    character_end: start + needle.length,
    quoted_text: source.slice(start, start + needle.length)
  };
}

function buildChunkRanges(text, chunkRows) {
  let searchFrom = 0;
  return chunkRows.map((chunk) => {
    const span = findTextSpan(text, chunk.content, searchFrom);
    if (span) searchFrom = span.character_end;
    return { chunk, span };
  });
}

function resolveEvidenceLocations({ text, record, chunkRanges }) {
  let attributes = record.attributes;
  if (typeof attributes === 'string') {
    try {
      attributes = JSON.parse(attributes);
    } catch (_error) {
      attributes = {};
    }
  }
  attributes = attributes && typeof attributes === 'object' ? attributes : {};
  const explicitEvidence = Array.isArray(attributes.evidence) ? attributes.evidence : [];
  const sourceText = attributes.source_sentence || attributes.source_text || record.canonical_name || record.mention_text || record.subject || record.source_entity;
  const fallbackSpan = findTextSpan(text, sourceText);
  const spans = explicitEvidence.length ? explicitEvidence : (fallbackSpan ? [fallbackSpan] : []);

  return spans.map((span) => {
    const range = chunkRanges.find(({ span: chunkSpan }) => chunkSpan && span.character_start >= chunkSpan.character_start && span.character_start < chunkSpan.character_end);
    const locationMetadata = range ? (range.chunk.location_metadata || {}) : {};
    return {
      chunk: range ? range.chunk : null,
      source_location: range ? `chunk:${range.chunk.sequence}` : 'unresolved',
      metadata: {
        ...locationMetadata,
        character_start: span.character_start,
        character_end: span.character_end,
        quoted_text: span.quoted_text,
        resolved: Boolean(range)
      }
    };
  });
}

function persistRecordEvidence({ artifact, contentRep, record, targetKey, text, chunkRanges }) {
  const locations = resolveEvidenceLocations({ text, record, chunkRanges });
  locations.forEach((location) => {
    insertEvidence({
      artifact_id: artifact.id,
      content_representation_id: contentRep.id,
      chunk_id: location.chunk ? location.chunk.id : null,
      source_location: location.source_location,
      metadata: { [targetKey]: record.id, ...location.metadata }
    });
  });
}

function parseRecordAttributes(record) {
  if (!record || typeof record.attributes !== 'string') return record && record.attributes ? record.attributes : {};
  try {
    return JSON.parse(record.attributes);
  } catch (_error) {
    return {};
  }
}

function persistContext(attributes = {}) {
  const context = attributes.context || {};
  const jurisdiction = context.jurisdiction ? insertJurisdiction({ type: 'JURISDICTION', name: context.jurisdiction }) : null;
  const temporal = context.temporal ? insertTemporalScope({
    valid_from: context.temporal.valid_from || null,
    valid_to: context.temporal.valid_to || null,
    metadata: { source: 'rule-based-candidate' }
  }) : null;
  if (!jurisdiction && !temporal && !context.population && !context.conditions) return null;
  return insertContext({
    jurisdiction_id: jurisdiction ? jurisdiction.id : null,
    temporal_scope_id: temporal ? temporal.id : null,
    population: context.population || null,
    conditions: context.conditions || null,
    metadata: { source: 'rule-based-candidate' }
  });
}

function findAssertionContradictions(assertions) {
  const contradictionPairs = [];
  for (let leftIndex = 0; leftIndex < assertions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assertions.length; rightIndex += 1) {
      const left = assertions[leftIndex];
      const right = assertions[rightIndex];
      const leftAttributes = parseRecordAttributes(left);
      const rightAttributes = parseRecordAttributes(right);
      const sameSubject = String(left.subject || '').toLowerCase() === String(right.subject || '').toLowerCase();
      const differentSources = left.source_id !== right.source_id || (leftAttributes.source_reference && rightAttributes.source_reference && leftAttributes.source_reference !== rightAttributes.source_reference);
      const differentOutcomes = left.predicate === right.predicate && String(left.object || '').toLowerCase() !== String(right.object || '').toLowerCase();
      const explicitOutcomeConflict = [left.predicate, right.predicate].includes('NO_STATISTICALLY_SIGNIFICANT_EFFECT') && [left.predicate, right.predicate].some((predicate) => ['REDUCES', 'INCREASES', 'IMPROVES'].includes(predicate));
      if (sameSubject && differentSources && (differentOutcomes || explicitOutcomeConflict)) {
        const contradicting = left.predicate === 'NO_STATISTICALLY_SIGNIFICANT_EFFECT' ? left : right;
        const contradicted = contradicting.id === left.id ? right : left;
        contradictionPairs.push({ source_assertion_id: contradicting.id, target_assertion_id: contradicted.id });
      }
    }
  }
  return contradictionPairs;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json(buildPublicContext({ status: 'ok', project: 'C3 Universal Information Foundation' }));
});

app.get('/api/sources', (req, res) => {
  res.json(buildPublicContext({ sources: listSources() }));
});

app.get('/api/artifacts', (req, res) => {
  res.json(buildPublicContext({ artifacts: listArtifacts() }));
});

app.get('/api/records', (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  const result = q ? searchRecords(q) : listRecords();
  res.json(buildPublicContext(result));
});

function persistExtractionForArtifact({ source, artifact, fileBuffer, mimeType, sourceName, processingVersion = '1.0' }) {
  return (async () => {
    const parsed = await parseDocument(fileBuffer, mimeType, sourceName);
    const aiContext = buildAiContextBundle(parsed);
    const contentRep = insertContentRepresentation({
      artifact_id: artifact.id,
      processing_version: processingVersion,
      representation_type: parsed.sourceType || 'text',
      metadata: {
        original_title: sourceName,
        chunk_count: parsed.chunks.length,
        mime_type: mimeType,
        ai_context: aiContext.compactContext
      }
    });

    const chunkRows = parsed.chunks.map((chunk, index) => insertChunk({
      content_representation_id: contentRep.id,
      sequence: index + 1,
      content: chunk.content,
      location_metadata: chunk.location_metadata || { index: index + 1 }
    }));
    const chunkRanges = buildChunkRanges(parsed.text, chunkRows);

    const extraction = insertExtraction({
      source_id: source.id,
      artifact_id: artifact.id,
      processing_version: processingVersion,
      schema_version: '2.0',
      method: 'rule-based-candidate',
      model: 'local',
      model_version: 'rule-based-v2',
      prompt_version: 'initial-v1',
      status: 'completed'
    });

    const structured = extractStructuredContent(parsed.text);
    const entityRecords = structured.entities.slice(0, 10);
    const insertedEntities = entityRecords.map((entity) => insertEntity({
      extraction_id: extraction.id,
      type: entity.type,
      canonical_name: entity.canonical_name,
      attributes: entity.attributes
    }));

    const entityMentions = insertedEntities.map((entity, index) => {
      const sourceEntity = entityRecords[index];
      const canonicalEntity = insertCanonicalEntity({
        type: sourceEntity.type,
        canonical_name: sourceEntity.canonical_name,
        attributes: { source: 'heuristic-canonicalization' }
      });
      insertEntityAlias({
        canonical_entity_id: canonicalEntity.id,
        alias: sourceEntity.canonical_name,
        alias_type: 'observed-label'
      });
      return insertEntityMention({
        extraction_id: extraction.id,
        entity_id: entity.id,
        canonical_entity_id: canonicalEntity.id,
        mention_text: sourceEntity.canonical_name,
        confidence: null,
        attributes: sourceEntity.attributes
      });
    });
    const canonicalEntityIdsByName = new Map(entityMentions.map((mention) => [mention.mention_text.toLowerCase(), mention.canonical_entity_id]));

    const claimRecords = structured.claims.slice(0, 10);
    const insertedClaims = claimRecords.map((claim) => insertClaim({
      extraction_id: extraction.id,
      claim_type: claim.claim_type,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      attributes: claim.attributes
    }));

    const propositions = insertedClaims.map((claim, index) => {
      const sourceClaim = claimRecords[index];
      const context = persistContext(sourceClaim.attributes);
      return insertProposition({
        proposition_type: sourceClaim.claim_type === 'source_assertion' ? 'source_proposition' : 'proposition',
        subject_entity_id: canonicalEntityIdsByName.get(String(claim.subject || '').toLowerCase()) || null,
        subject_text: claim.subject,
        predicate: claim.predicate,
        object_entity_id: canonicalEntityIdsByName.get(String(claim.object || '').toLowerCase()) || null,
        object_text: claim.object,
        context_id: context ? context.id : null,
        attributes: sourceClaim.attributes
      });
    });

    const sourceAssertions = insertedClaims.map((claim, index) => {
      const sourceClaim = structured.claims[index];
      const claimAttributes = sourceClaim.attributes || {};
      const assertion = insertSourceAssertion({
        source_id: source.id,
        artifact_id: artifact.id,
        extraction_id: extraction.id,
        claim_id: claim.id,
        proposition_id: propositions[index].id,
        subject: claim.subject,
        predicate: claim.predicate,
        object: claim.object,
        assertion_text: claimAttributes.source_sentence || `${claim.subject} ${claim.predicate} ${claim.object}`,
        attributes: claimAttributes
      });
      insertAssessment({
        target_type: 'source_assertion',
        target_id: assertion.id,
        status: 'unassessed',
        metadata: { reason: 'Source assertion preserved without treating extraction as verification.' }
      });
      return assertion;
    });
    const priorAssertions = db.prepare('SELECT * FROM source_assertions WHERE id NOT IN (' + sourceAssertions.map(() => '?').join(',') + ')').all(...sourceAssertions.map((assertion) => assertion.id));
    const currentAssertionIds = new Set(sourceAssertions.map((assertion) => assertion.id));
    const assertionRelations = findAssertionContradictions([...sourceAssertions, ...priorAssertions])
      .filter((relation) => currentAssertionIds.has(relation.source_assertion_id) || currentAssertionIds.has(relation.target_assertion_id))
      .map((relation) => insertAssertionRelation({
      ...relation,
      relation_type: 'CONTRADICTS',
      metadata: { method: 'rule-based-candidate-v2', status: 'candidate' }
      }));

    const insertedObservations = structured.observations.slice(0, 10).map((observation) => insertObservation({
      extraction_id: extraction.id,
      observation_type: observation.observation_type,
      subject: observation.subject,
      value: observation.value,
      unit: observation.unit,
      attributes: observation.attributes
    }));

    const states = insertedObservations.map((observation, index) => {
      const sourceObservation = structured.observations[index];
      const context = persistContext(sourceObservation.attributes);
      return insertState({
        subject_entity_id: canonicalEntityIdsByName.get(String(observation.subject || '').toLowerCase()) || null,
        state_type: observation.observation_type,
        value: observation.value,
        unit: observation.unit,
        context_id: context ? context.id : null,
        attributes: sourceObservation.attributes
      });
    });

    const events = propositions.filter((proposition) => ['AMENDED_IN', 'SUPERSEDED_BY'].includes(proposition.predicate)).map((proposition) => insertEvent({
      event_type: proposition.predicate === 'AMENDED_IN' ? 'AMENDMENT' : 'SUPERSESSION',
      subject_entity_id: proposition.subject_entity_id,
      object_entity_id: proposition.object_entity_id,
      context_id: proposition.context_id,
      attributes: { proposition_id: proposition.id }
    }));

    const rules = propositions.filter((proposition) => ['REQUIRES', 'GOVERNS', 'REGULATES', 'ELIGIBLE_FOR'].includes(proposition.predicate)).map((proposition) => insertRule({
      rule_type: 'extracted_rule',
      subject_entity_id: proposition.subject_entity_id,
      predicate: proposition.predicate,
      object_entity_id: proposition.object_entity_id,
      context_id: proposition.context_id,
      conditions: proposition.context_id ? 'See context.conditions' : null,
      effective_from: null,
      effective_to: null,
      status: 'candidate',
      attributes: { proposition_id: proposition.id }
    }));

    const insertedRelationships = structured.relationships.slice(0, 10).map((relationship) => insertRelationship({
      extraction_id: extraction.id,
      subject_entity_id: canonicalEntityIdsByName.get(String(relationship.source_entity || '').toLowerCase()) || null,
      object_entity_id: canonicalEntityIdsByName.get(String(relationship.target_entity || '').toLowerCase()) || null,
      relationship_type: relationship.relationship_type,
      source_entity: relationship.source_entity,
      target_entity: relationship.target_entity,
      attributes: relationship.attributes
    }));

    const mechanisms = insertedRelationships.filter((relationship) => ['AFFECTS', 'CAUSES', 'CORRELATES_WITH', 'DEPENDS_ON'].includes(relationship.relationship_type)).map((relationship) => {
      const context = persistContext(parseRecordAttributes(relationship));
      return insertMechanism({
        mechanism_type: relationship.relationship_type,
        source_entity_id: relationship.subject_entity_id,
        target_entity_id: relationship.object_entity_id,
        context_id: context ? context.id : null,
        attributes: { relationship_id: relationship.id }
      });
    });

    entityMentions.forEach((mention) => persistRecordEvidence({ artifact, contentRep, record: mention, targetKey: 'entity_mention_id', text: parsed.text, chunkRanges }));
    insertedClaims.forEach((claim) => persistRecordEvidence({ artifact, contentRep, record: claim, targetKey: 'claim_id', text: parsed.text, chunkRanges }));
    sourceAssertions.forEach((assertion) => persistRecordEvidence({ artifact, contentRep, record: assertion, targetKey: 'assertion_id', text: parsed.text, chunkRanges }));
    insertedObservations.forEach((observation) => persistRecordEvidence({ artifact, contentRep, record: observation, targetKey: 'observation_id', text: parsed.text, chunkRanges }));
    insertedRelationships.forEach((relationship) => persistRecordEvidence({ artifact, contentRep, record: relationship, targetKey: 'relationship_id', text: parsed.text, chunkRanges }));

    insertScope({
      extraction_id: extraction.id,
      geography: null,
      population: null,
      time_period: null,
      conditions: null,
      definitions: null,
      metadata: { source: 'ingest', status: 'unresolved' }
    });

    return {
      parsed,
      aiContext,
      contentRepresentation: contentRep,
      extraction,
      entities: insertedEntities,
      entityMentions,
      claims: insertedClaims,
      propositions,
      sourceAssertions,
      assertionRelations,
      observations: insertedObservations,
      states,
      events,
      rules,
      relationships: insertedRelationships,
      mechanisms,
      chunks: chunkRows
    };
  })();
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'A file is required.' });
    }

    const fileBuffer = fs.readFileSync(file.path);
    const inferredMimeType = inferMimeTypeFromFilename(file.originalname || 'document');
    const mimeType = req.body.mimeType || (file.mimetype && file.mimetype !== 'application/octet-stream' ? file.mimetype : inferredMimeType);
    const contentHash = hashContent(fileBuffer);
    const extension = path.extname(file.originalname || 'upload.dat') || '.bin';
    const storedFileName = `${contentHash}${extension}`;
    const storedFilePath = path.join(uploadDir, storedFileName);
    if (!fs.existsSync(storedFilePath)) {
      fs.copyFileSync(file.path, storedFilePath);
    }
    fs.unlinkSync(file.path);

    const sourceName = path.basename(file.originalname || 'uploaded-document', extension) || 'Uploaded document';
    const existingArtifact = getArtifactByHash(contentHash);

    let source;
    let artifact;
    let processed;
    let message = 'Artifact ingested successfully';

    if (existingArtifact) {
      source = db.prepare('SELECT * FROM sources WHERE id = ?').get(existingArtifact.source_id) || insertSource({
        type: mimeType,
        uri: storedFilePath,
        title: sourceName,
        publisher: 'Uploaded by user',
        retrieved_at: new Date().toISOString(),
        metadata: { file_name: file.originalname, source: 'upload' }
      });
      artifact = existingArtifact;
      message = 'Artifact already exists; reusing the preserved artifact and creating a new extraction record.';
      processed = await persistExtractionForArtifact({
        source,
        artifact,
        fileBuffer,
        mimeType,
        sourceName,
        processingVersion: 'reprocess-duplicate'
      });
    } else {
      source = insertSource({
        type: mimeType,
        uri: storedFilePath,
        title: sourceName,
        publisher: 'Uploaded by user',
        retrieved_at: new Date().toISOString(),
        metadata: { file_name: file.originalname, source: 'upload' }
      });

      artifact = insertArtifact({
        source_id: source.id,
        content_hash: contentHash,
        mime_type: mimeType,
        byte_size: fileBuffer.length,
        storage_location: storedFilePath,
        created_at: new Date().toISOString()
      });

      processed = await persistExtractionForArtifact({
        source,
        artifact,
        fileBuffer,
        mimeType,
        sourceName,
        processingVersion: '1.0'
      });
    }

    res.json(buildPublicContext({
      message,
      source,
      artifact,
      parsed: processed.parsed,
      aiContext: processed.aiContext,
      contentRepresentation: processed.contentRepresentation,
      extracted: {
        entities: processed.entities,
        claims: processed.claims,
        propositions: processed.propositions,
        observations: processed.observations,
        states: processed.states,
        events: processed.events,
        rules: processed.rules,
        relationships: processed.relationships,
        mechanisms: processed.mechanisms,
        sourceAssertions: processed.sourceAssertions,
        assertionRelations: processed.assertionRelations,
        chunks: processed.chunks,
        extraction: processed.extraction
      }
    }));
  } catch (error) {
    console.error('Upload failed:', error);
    return res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

app.get('/api/reprocess/:artifactId', async (req, res) => {
  const artifactId = Number(req.params.artifactId);
  const artifact = db.prepare('SELECT * FROM raw_artifacts WHERE id = ?').get(artifactId);
  if (!artifact) {
    return res.status(404).json({ error: 'Artifact not found.' });
  }

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(artifact.source_id);
  const fileBuffer = fs.readFileSync(artifact.storage_location);
  const parsed = await parseDocument(fileBuffer, artifact.mime_type, source.title || 'Reprocessed document');
  const aiContext = buildAiContextBundle(parsed);

  res.json(buildPublicContext({
    artifact,
    source,
    parsed,
    aiContext,
    reprocessed: extractStructuredContent(parsed.text),
    note: 'Reprocessing preserved the original artifact and generated a new extraction version.'
  }));
});

app.get('/api/ai-context/:artifactId', async (req, res) => {
  const artifactId = Number(req.params.artifactId);
  const artifact = db.prepare('SELECT * FROM raw_artifacts WHERE id = ?').get(artifactId);
  if (!artifact) {
    return res.status(404).json({ error: 'Artifact not found.' });
  }

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(artifact.source_id);
  const fileBuffer = fs.readFileSync(artifact.storage_location);
  const parsed = await parseDocument(fileBuffer, artifact.mime_type, source.title || 'Ai context');
  res.json(buildPublicContext({
    artifact,
    source,
    aiContext: buildAiContextBundle(parsed)
  }));
});

app.get('/api/knowledge-base', (req, res) => {
  const records = listRecords();
  const graph = buildKnowledgeBaseGraph({
    sources: records.sources || [],
    entities: records.entities || [],
    relationships: records.relationships || [],
    claims: records.claims || [],
    observations: records.observations || []
  });

  const knowledgeBase = {
    schemaVersion: graph.schemaVersion,
    title: graph.title,
    description: graph.description,
    sources: records.sources || [],
    artifacts: records.artifacts || [],
    nodes: graph.nodes,
    edges: graph.edges,
    summary: {
      sourceCount: (records.sources || []).length,
      artifactCount: (records.artifacts || []).length,
      nodeCount: graph.summary.nodeCount,
      edgeCount: graph.summary.edgeCount,
      relationshipCount: graph.summary.relationshipCount,
      claimCount: graph.summary.claimCount,
      observationCount: graph.summary.observationCount
    }
  };

  res.json(buildPublicContext({ knowledgeBase }));
});

app.get('/api/ontology', (req, res) => {
  const records = listRecords();
  const graph = buildKnowledgeBaseGraph({
    sources: records.sources || [],
    entities: records.entities || [],
    relationships: records.relationships || [],
    claims: records.claims || [],
    observations: records.observations || []
  });

  const counts = {};
  for (const node of graph.nodes) {
    const type = node.ontologyType || node.type || 'ENTITY';
    counts[type] = (counts[type] || 0) + 1;
  }

  res.json(buildPublicContext({
    ontology: {
      schemaVersion: graph.schemaVersion,
      types: Object.entries(counts).map(([type, count]) => ({ type, count })),
      definitions: listOntologyDefinitions()
    }
  }));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`C3 Universal Information Foundation MVP listening on http://localhost:${port}`);
});

module.exports = app;
