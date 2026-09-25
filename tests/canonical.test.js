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
  assert.ok(Array.isArray(records.states));
  assert.ok(Array.isArray(records.events));
  assert.ok(Array.isArray(records.rules));
  assert.ok(Array.isArray(records.mechanisms));
});