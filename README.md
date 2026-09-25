# C3 Universal Information Foundation MVP

This project implements a source-grounded information foundation that can ingest a source artifact, preserve the original bytes, parse the content into chunks, run replaceable candidate extraction, and store structured records with evidence and provenance.

## Features
- Upload artifacts for PDF, HTML, plain text, CSV, JSON, and Markdown
- Preserve the original file in `storage/uploads/`
- Create content representations and chunk records
- Extract entities, claims, observations, and relationships
- Store evidence links to chunk locations
- Search extracted records
- Expose a compact AI-ready knowledge bundle for downstream reasoning and graph mapping
- Provide a layered architecture that supports future 3D system mapping and optimization

## Layered architecture
This project is intentionally structured as a multi-stage system, not just a local data store:

1. Source layer: preserve raw artifacts and source metadata.
2. Parser layer: normalize and chunk content across formats.
3. Canonical extraction layer: classify entities, claims, relationships, and observations.
4. AI knowledge base layer: compact the graph into a reasoning-friendly bundle.
5. Identity layer: distinguish document-level entity mentions from stable canonical entities and aliases.
6. Scope layer: provide first-class extension points for temporal scopes, jurisdictions, domains, ontology definitions, and taxonomies.
7. Simulation / 3D mapping layer: combine these signals into a system model for analysis and intervention planning.

The goal is to build the underlying knowledge foundation first, then use that foundation to drive a higher-level simulation and strategic decision layer.

## Evidence and identity guarantees
- Extracted claims, observations, relationships, and entity mentions carry character offsets and quoted source text when the source span is available.
- Evidence is resolved to the chunk containing the span. It is never assigned to the first chunk merely because it is convenient; unresolved evidence is explicitly marked as `unresolved`.
- Extracted entities are document-level records. `canonical_entities`, `entity_aliases`, and `entity_mentions` provide the stable identity layer needed to connect mentions across documents.
- Relationships retain their source and target names for compatibility and also store canonical subject/object IDs when those entities resolve within the extraction.
- Temporal scopes, jurisdictions, domains, entity types, relationship types, and taxonomy tables are available as canonical storage primitives. The current heuristic extractor does not pretend to populate those concepts completely.

The AI context remains a derived view. It is generated from canonical storage and evidence rather than acting as the source of truth.

## Run locally
```bash
cd /srv/projects/c3-info-foundation
npm install
npm start
```

Then open http://localhost:3000

## Test
```bash
cd /srv/projects/c3-info-foundation
npm test
```

## Notes
This is intentionally a robust MVP rather than a speculative simulation layer. It focuses on durable information capture and traceability as the foundation for future system mapping and analysis.
