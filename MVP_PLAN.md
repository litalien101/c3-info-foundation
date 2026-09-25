# MVP Plan

## Priority 1: working vertical slice
1. Register a source.
2. Preserve the original artifact.
3. Parse the content into chunks.
4. Run extraction heuristics.
5. Persist entities, claims, observations, and relationships.
6. Link them back to source evidence.
7. Expose them via search and record views.

## Priority 2: data integrity
- Validate required fields.
- Track processing provenance.
- Store content hashes and raw artifact references.
- Preserve multiple versions when material changes occur.

## Priority 3: lifecycle
- Provide reprocessing from the saved artifact.
- Support extraction version tracking.
- Add conflict and match metadata for future deduplication.

## Priority 4: usability
- Improve filtering and source browsing.
- Support review workflows and evidence drilldown.
- Add stronger indexing and external API integration later.

## Current implementation status
This repository contains the working vertical slice and the core preservation model required for the initial C3 information foundation.
