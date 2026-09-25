# C3 Universal Information Foundation MVP

This project implements a source-grounded information foundation that can ingest a source artifact, preserve the original bytes, parse the content into chunks, run replaceable candidate extraction, and store structured records with evidence and provenance.

## Features
- Upload artifacts for PDF, HTML, plain text, CSV, JSON, and Markdown
- Preserve the original file in `storage/uploads/`
- Create content representations and chunk records
- Extract entities, claims, observations, and relationships
- Extract candidate processes with ordered steps and transitions
- Project canonical propositions, states, events, rules, mechanisms, and workflows into the knowledge graph
- Store evidence links to chunk locations
- Search extracted records
- Expose a compact AI-ready knowledge bundle for downstream reasoning and graph mapping
- Provide a layered architecture that supports future 3D system mapping and optimization

## Layered architecture
This project is intentionally structured as a multi-stage system, not just a local data store:

1. Source layer: preserve raw artifacts and source metadata.
2. Parser layer: normalize and chunk content across formats.
3. Canonical extraction layer: classify candidate entities, propositions, states, events, rules, mechanisms, and workflows.
4. Knowledge representation layer: resolve repeated candidates and project canonical objects into graph-ready structures.
5. AI context layer: compact assessed storage and evidence into a reasoning-friendly bundle.
6. Identity and scope layers: distinguish mentions from canonical entities and attach jurisdiction, time, population, and condition context.
7. Future system analysis and simulation layers: use the foundation for dependencies, flows, scenarios, and eventually visualization.

The goal is to build the underlying knowledge foundation first, then use that foundation to drive a higher-level simulation and strategic decision layer.

## Evidence and identity guarantees
- Extracted claims, observations, relationships, and entity mentions carry character offsets and quoted source text when the source span is available.
- The candidate extractor recognizes typed entities, canonical relationship predicates, source-reported assertions, jurisdiction phrases, temporal expressions, populations, and conditional language. It is deterministic and replaceable; it is not presented as a general language model.
- Evidence is resolved to the chunk containing the span. It is never assigned to the first chunk merely because it is convenient; unresolved evidence is explicitly marked as `unresolved`.
- Extracted entities are document-level records. `canonical_entities`, `entity_aliases`, and `entity_mentions` provide the stable identity layer needed to connect mentions across documents.
- Relationships retain their source and target names for compatibility and also store canonical subject/object IDs when those entities resolve within the extraction.
- Temporal scopes, jurisdictions, domains, entity types, relationship types, and taxonomy tables are available as canonical storage primitives. The current heuristic extractor does not pretend to populate those concepts completely.
- When separately referenced source assertions make incompatible outcome claims about the same subject, ingestion records a candidate `CONTRADICTS` relation. No source is automatically declared correct.
- `canonical` means normalized C3 representation, not objectively true. Validity, confidence, and promotion remain assessment concerns.
- Workflow candidates preserve ordered process steps and transitions; they are not yet a complete operational workflow engine.

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
