# C3 Universal Information Foundation Architecture

## Purpose
This MVP establishes the durable information foundation for ingesting source documents, preserving original artifacts, extracting structured records, and tracing those records back to evidence.

## Layers

### 1. Source registration
- Accepts uploaded files and stores the source metadata.
- Records source type, title, URI-like path, and retrieval timestamp.

### 2. Artifact preservation
- Saves the original file bytes under `storage/uploads/`.
- Stores a hash to support deduplication and integrity checks.
- Keeps the raw artifact independent from derived output.

### 3. Content representation
- Converts the artifact into normalized text and chunked content.
- Supports PDF, HTML, text, CSV, JSON, and Markdown formats.
- Keeps chunk metadata available for later evidence tracing.

### 4. Extraction
- Uses a deterministic heuristic extraction layer to create entities, claims, observations, and relationships.
- Stores extraction metadata including processing and schema version.
- Treats heuristic output as candidate information, not verified truth.
- Creates source assertions and unassessed assessments so later sources can support, contradict, review, or supersede an assertion.
- Generates structured, queryable output while preserving evidence links.

### 5. Canonical storage
- Uses SQLite as the initial relational storage layer.
- Stores source, artifact, content, extraction, and evidence records.
- Separates canonical entities from document-level mentions and aliases.
- Stores data-backed entity types, relationship types, domains, jurisdictions, temporal scopes, and taxonomies.
- Keeps claims, relationships, and assertions independently traceable to their provenance.
- Supports future migration to PostgreSQL without changing the canonical design.

### 6. Assessment and disagreement layer
- Records assessments separately from source assertions.
- Preserves competing assertions and explicit `SUPPORTS` or `CONTRADICTS` relations without forcing an early truth decision.
- Keeps review, confidence, rationale, and revision metadata available for human or downstream evaluation.

### 7. AI knowledge base layer
- Takes canonical records and packages them into a graph-ready, compact context layer.
- Produces entity, relationship, observation, and summary bundles that are easier for AI systems to reason over.
- Keeps the raw source and the derived graph separated, so the system remains auditable.

### 8. Simulation / 3D system map layer
- Uses the knowledge base to reconstruct systems, dependencies, flows, outcomes, and bottlenecks.
- Maps public systems, services, agencies, regulations, and effects into a 3D or graph-like operational model.
- Enables scenario testing and improvement analysis before real-world changes are implemented.

### 9. Decision layer
- Compares the current system state to alternative configurations.
- Scores the likely impact of interventions using the extracted structure, evidence, and system relationships.
- Produces recommendation outputs that can feed back into operational planning.

## Key implementation principle
This MVP deliberately avoids destructive normalization. Where the source contains a value, unit, population, geography, or definition, the system preserves the original text and stores its derived interpretation alongside it.

## Long-term objective
The system is not meant to be a website that simply stores parsed data. It is meant to become an operational knowledge foundation for a larger AI-driven model of the United States' systems: sources become evidence, the parser becomes the ingestion layer, the canonical graph becomes the system map, and the AI knowledge base becomes the reasoning layer that powers interactive 3D visualization and systems optimization.

## File structure
- `src/server.js`: HTTP API and upload pipeline
- `src/db.js`: SQLite schema and data access functions
- `src/ingestion.js`: parsing and extraction logic
- `public/index.html`: UI for upload and exploration
- `storage/uploads`: preserved artifact storage
