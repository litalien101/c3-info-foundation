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
An asserted statement that may or may not be true as represented by the source.
- id
- extraction_id
- claim_type
- subject
- predicate
- object
- attributes

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
A directed or typed relation between entities or concepts.
- id
- extraction_id
- relationship_type
- source_entity
- target_entity
- attributes

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
- Reprocessing is allowed by re-running the extraction step against the preserved artifact.
- Historical or revisionary records can be extended by adding version metadata in the future.
