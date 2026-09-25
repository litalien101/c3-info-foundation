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

    const extraction = insertExtraction({
      source_id: source.id,
      artifact_id: artifact.id,
      processing_version: processingVersion,
      schema_version: '1.0',
      method: 'heuristic',
      model: 'local',
      model_version: 'heuristic-v1',
      prompt_version: 'initial-v1',
      status: 'completed'
    });

    const structured = extractStructuredContent(parsed.text);
    const insertedEntities = structured.entities.slice(0, 10).map((entity) => insertEntity({
      extraction_id: extraction.id,
      type: entity.type,
      canonical_name: entity.canonical_name,
      attributes: entity.attributes
    }));

    const insertedClaims = structured.claims.slice(0, 10).map((claim) => insertClaim({
      extraction_id: extraction.id,
      claim_type: claim.claim_type,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      attributes: claim.attributes
    }));

    const insertedObservations = structured.observations.slice(0, 10).map((observation) => insertObservation({
      extraction_id: extraction.id,
      observation_type: observation.observation_type,
      subject: observation.subject,
      value: observation.value,
      unit: observation.unit,
      attributes: observation.attributes
    }));

    const insertedRelationships = structured.relationships.slice(0, 10).map((relationship) => insertRelationship({
      extraction_id: extraction.id,
      relationship_type: relationship.relationship_type,
      source_entity: relationship.source_entity,
      target_entity: relationship.target_entity,
      attributes: relationship.attributes
    }));

    const primaryChunk = chunkRows[0] || null;
    if (primaryChunk) {
      insertedEntities.forEach((entity, index) => {
        insertEvidence({
          artifact_id: artifact.id,
          content_representation_id: contentRep.id,
          chunk_id: primaryChunk.id,
          source_location: `chunk:${index + 1}`,
          metadata: { entity_id: entity.id, entity_type: entity.type }
        });
      });

      insertedClaims.forEach((claim, index) => {
        insertEvidence({
          artifact_id: artifact.id,
          content_representation_id: contentRep.id,
          chunk_id: primaryChunk.id,
          source_location: `chunk:${index + 1}`,
          metadata: { claim_id: claim.id, claim_type: claim.claim_type }
        });
      });

      insertedObservations.forEach((obs, index) => {
        insertEvidence({
          artifact_id: artifact.id,
          content_representation_id: contentRep.id,
          chunk_id: primaryChunk.id,
          source_location: `chunk:${index + 1}`,
          metadata: { observation_id: obs.id }
        });
      });

      insertedRelationships.forEach((rel, index) => {
        insertEvidence({
          artifact_id: artifact.id,
          content_representation_id: contentRep.id,
          chunk_id: primaryChunk.id,
          source_location: `chunk:${index + 1}`,
          metadata: { relationship_id: rel.id }
        });
      });
    }

    insertScope({
      extraction_id: extraction.id,
      geography: 'Unknown',
      population: 'General population',
      time_period: 'Not specified',
      conditions: 'Source-defined',
      definitions: 'Preserved source language',
      metadata: { source: 'ingest' }
    });

    return {
      parsed,
      aiContext,
      contentRepresentation: contentRep,
      extraction,
      entities: insertedEntities,
      claims: insertedClaims,
      observations: insertedObservations,
      relationships: insertedRelationships,
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
        observations: processed.observations,
        relationships: processed.relationships,
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
      types: Object.entries(counts).map(([type, count]) => ({ type, count }))
    }
  }));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`C3 Universal Information Foundation MVP listening on http://localhost:${port}`);
});

module.exports = app;
