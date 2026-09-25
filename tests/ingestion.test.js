const test = require('node:test');
const assert = require('node:assert/strict');

const { parseContent, parseDocument, buildAiContextBundle, buildKnowledgeBaseGraph, extractStructuredContent } = require('../src/ingestion');

test('parseContent extracts paragraphs and chunks from markdown text', () => {
  const result = parseContent('text/markdown', '# Child Support Program\n\nThe program reduces poverty.\n\nUnemployment fell from 7.1% to 6.4%.');

  assert.equal(result.title, 'Child Support Program');
  assert.ok(result.chunks.length >= 2);
  assert.ok(result.text.includes('The program reduces poverty.'));
});

test('extractStructuredContent yields entities, claims, observations and relationships', () => {
  const result = extractStructuredContent('The Child Support Program reduces poverty. Unemployment fell from 7.1% to 6.4%. The program affects families and depends on court systems.');

  assert.ok(result.entities.length >= 2);
  assert.ok(result.claims.length >= 1);
  assert.ok(result.observations.length >= 1);
  assert.ok(result.relationships.length >= 1);
  const claimEvidence = result.claims[0].attributes.evidence[0];
  assert.equal(claimEvidence.quoted_text, 'The Child Support Program reduces poverty.');
  assert.equal(claimEvidence.character_start, 0);
  assert.ok(claimEvidence.character_end > claimEvidence.character_start);
});

test('extractStructuredContent removes repeated entity and claim duplicates', () => {
  const result = extractStructuredContent('The Child Support Program reduces poverty. The Child Support Program reduces poverty.');

  const programMatches = result.entities.filter((entity) => entity.canonical_name.toLowerCase().includes('child support program'));
  const claimMatches = result.claims.filter((claim) => claim.subject.toLowerCase().includes('child support program') && claim.predicate.toLowerCase() === 'reduces');

  assert.ok(programMatches.length <= 2);
  assert.ok(claimMatches.length === 1);
});

test('extractStructuredContent captures jurisdiction, conditions, time, and competing source assertions', () => {
  const result = extractStructuredContent('Under Minnesota law, Agency X administers Program Y for eligible families if income is below the threshold. Regulation R was amended in 2024. Source A says Program Y reduced participation, while Source B reports no statistically significant effect.');

  const administers = result.claims.find((claim) => claim.predicate === 'ADMINISTERS');
  const amendment = result.claims.find((claim) => claim.predicate === 'AMENDED_IN');
  const sourceA = result.claims.find((claim) => claim.attributes.source_reference === 'A');
  const sourceB = result.claims.find((claim) => claim.attributes.source_reference === 'B');

  assert.equal(administers.attributes.context.jurisdiction, 'Minnesota');
  assert.equal(administers.attributes.context.population, 'eligible families');
  assert.equal(administers.attributes.context.conditions, 'income is below the threshold');
  assert.equal(amendment.attributes.context.temporal.valid_from, '2024');
  assert.equal(sourceA.predicate, 'REDUCES');
  assert.equal(sourceB.predicate, 'NO_STATISTICALLY_SIGNIFICANT_EFFECT');
});

test('parseDocument supports structured and unstructured formats and builds AI-ready context', async () => {
  const jsonDoc = {
    title: 'Programs',
    programs: [
      { name: 'Child Support Program', affects: 'families', depends_on: 'court system' },
      { name: 'Employment Service', affects: 'workers' }
    ]
  };

  const parsed = await parseDocument(Buffer.from(JSON.stringify(jsonDoc)), 'application/json', 'programs');
  const context = buildAiContextBundle(parsed);

  assert.equal(parsed.sourceType, 'json');
  assert.ok(parsed.sections.length >= 1);
  assert.ok(context.entities.length >= 2);
  assert.ok(context.relationships.length >= 1);
  assert.ok(context.summary.length > 0);
});

test('buildKnowledgeBaseGraph creates a graph-ready node and edge model', () => {
  const graph = buildKnowledgeBaseGraph({
    entities: [
      { canonical_name: 'Child Support Program', type: 'PROGRAM' },
      { canonical_name: 'Families', type: 'POPULATION' }
    ],
    relationships: [
      { relationship_type: 'AFFECTS', source_entity: 'Child Support Program', target_entity: 'Families' }
    ],
    claims: [
      { subject: 'Child Support Program', predicate: 'reduces', object: 'poverty' }
    ],
    observations: [
      { subject: 'Child Support Program', value: '7.1', unit: '%' }
    ]
  });

  assert.equal(graph.schemaVersion, '1.0');
  assert.ok(graph.nodes.some((node) => node.label === 'Child Support Program'));
  assert.ok(graph.edges.some((edge) => edge.type === 'AFFECTS'));
  assert.ok(graph.summary.nodeCount >= 2);
  assert.ok(graph.summary.edgeCount >= 1);
});

test('ontology typing normalizes agencies, services, populations, and geography', () => {
  const graph = buildKnowledgeBaseGraph({
    entities: [
      { canonical_name: 'Department of Health', type: 'AGENCY' },
      { canonical_name: 'Medicaid Service', type: 'SERVICE' },
      { canonical_name: 'Low-income families', type: 'POPULATION' },
      { canonical_name: 'California', type: 'GEOGRAPHY' }
    ],
    relationships: [
      { relationship_type: 'SUPPORTS', source_entity: 'Department of Health', target_entity: 'Low-income families' }
    ]
  });

  const agencyNode = graph.nodes.find((node) => node.label === 'Department of Health');
  const serviceNode = graph.nodes.find((node) => node.label === 'Medicaid Service');
  const populationNode = graph.nodes.find((node) => node.label === 'Low-income families');
  const geographyNode = graph.nodes.find((node) => node.label === 'California');

  assert.equal(agencyNode && agencyNode.ontologyType, 'AGENCY');
  assert.equal(serviceNode && serviceNode.ontologyType, 'SERVICE');
  assert.equal(populationNode && populationNode.ontologyType, 'POPULATION');
  assert.equal(geographyNode && geographyNode.ontologyType, 'GEOGRAPHY');
});
