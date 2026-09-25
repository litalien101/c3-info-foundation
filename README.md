# C3 Universal Information Foundation MVP

This project implements a working MVP information foundation that can ingest a source artifact, preserve the original bytes, parse the content into chunks, run heuristic extraction, and store structured evidence-backed records.

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
5. Simulation / 3D mapping layer: combine these signals into a system model for analysis and intervention planning.

The goal is to build the underlying knowledge foundation first, then use that foundation to drive a higher-level simulation and strategic decision layer.

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
