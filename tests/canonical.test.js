const test = require('node:test');
const assert = require('node:assert/strict');

const { listOntologyDefinitions, listRecords } = require('../src/db');

test('canonical ontology is seeded and source assertions are queryable', () => {
  const ontology = listOntologyDefinitions();
  const records = listRecords();

  assert.ok(ontology.domains.some((domain) => domain.name === 'C3 Core'));
  assert.ok(ontology.entity_types.some((type) => type.name === 'Program'));
  assert.ok(ontology.relationship_types.some((type) => type.name === 'CONTRADICTS'));
  assert.ok(Array.isArray(records.source_assertions));
  assert.ok(Array.isArray(records.assessments));
  assert.ok(Array.isArray(records.assertion_relations));
  assert.ok(Array.isArray(records.contexts));
  assert.ok(Array.isArray(records.propositions));
  assert.ok(Array.isArray(records.canonical_propositions));
  assert.ok(Array.isArray(records.proposition_resolutions));
  assert.ok(Array.isArray(records.states));
  assert.ok(Array.isArray(records.events));
  assert.ok(Array.isArray(records.rules));
  assert.ok(Array.isArray(records.mechanisms));
  assert.ok(Array.isArray(records.canonical_mechanisms));
  assert.ok(Array.isArray(records.mechanism_resolutions));
  assert.ok(Array.isArray(records.processes));
  assert.ok(Array.isArray(records.process_steps));
  assert.ok(Array.isArray(records.process_transitions));
  assert.ok(Array.isArray(records.resource_flows));
  assert.ok(Array.isArray(records.rule_conditions));
  assert.ok(Array.isArray(records.provenance_links));
});