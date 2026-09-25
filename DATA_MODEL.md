# C3 Universal Information Foundation Data Model

## Core objects

### Source
Represents the original intake record.
- id
- type
- uri
- title
- publisher
- published_at
- retrieved_at
- metadata

### RawArtifact
Represents the preserved original bytes.
- id
- source_id
- content_hash
- mime_type
- byte_size
- storage_location
- created_at

### ContentRepresentation
Represents derived content from the source artifact.
- id
- artifact_id
- processing_version
- representation_type
- metadata

### Chunk
Represents a retrievable piece of content with source location metadata.
- id
- content_representation_id
- sequence
- content
- location_metadata

### Extraction
Tracks how the structured output was produced.
- id
- source_id
- artifact_id
- processing_version
- schema_version
- method
- model
- model_version
- prompt_version
- created_at
- status

### Entity
Structured named things in the material.
- id
- extraction_id
- type
- canonical_name
- attributes

### Claim
The structured proposition extracted from a source. It is not itself a determination of truth.
- id
- extraction_id
- claim_type
- subject
- predicate
- object
- attributes

### SourceAssertion
The explicit statement a source makes about a proposition.
- id
- source_id
- artifact_id
- extraction_id
- claim_id
- assertion_type
- subject
- predicate
- object
- assertion_text
- status
- attributes

### Assessment
A separate evaluation of an assertion or other canonical object.
- id
- target_type
- target_id
- status
- confidence
- rationale
- reviewer
- metadata

### AssertionRelation
An explicit relation between source assertions, such as support or contradiction.
- id
- source_assertion_id
- target_assertion_id
- relation_type
- metadata

### Observation
A measured or observed value with scope and unit metadata.
- id
- extraction_id
- observation_type
- subject
- value
- unit
- attributes

### Relationship
A directed or typed relation between entities or concepts. The edge can carry stable subject/object IDs, temporal scope, jurisdiction, conditions, confidence, and provenance.
- id
- extraction_id
- relationship_type
- source_entity
- target_entity
- subject_entity_id
- object_entity_id
- temporal_scope_id
- jurisdiction_id
- attributes

### Ontology
Data-backed definitions shared across domains.
- `domains`
- `entity_types`
- `relationship_types`
- `taxonomy_nodes`
- `taxonomy_edges`

The heuristic extractor remains replaceable. It may propose types, but the ontology is stored as data rather than being defined only by extraction conditionals.

### Context
First-class scope objects that prevent false precision.
- `jurisdictions` with parent hierarchy
- `temporal_scopes` for publication, retrieval, effective, observed, and valid dates
- `scopes` for population, conditions, definitions, and links to jurisdiction/time

### Evidence
A reusable link from a result back to one or more source locations.
- id
- artifact_id
- content_representation_id
- chunk_id
- source_location
- metadata

## Design notes
- Canonical data remains independent of AI-specific infrastructure.
- Source statements are preserved as data, not treated as objective truth.
- Canonical knowledge must be derived through explicit assessment; extraction alone produces source assertions.
- Reprocessing is allowed by re-running the extraction step against the preserved artifact.
- Historical or revisionary records can be extended by adding version metadata in the future.
