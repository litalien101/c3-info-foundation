const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;
const cheerio = require('cheerio');
const { parse } = require('csv-parse/sync');

function normalizeWhitespace(value = '') {
  return String(value).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function splitIntoParagraphs(text = '') {
  return String(text)
    .replace(/\r/g, '')
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function titleFromText(text, fallback = 'Untitled source') {
  const match = String(text).match(/^#\s*(.+)$/m);
  if (match) return match[1].trim();
  const firstLine = String(text).split(/\n+/).map((line) => line.trim()).find(Boolean);
  if (firstLine) return firstLine.slice(0, 160);
  return fallback;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function findTextSpan(text, value, startAt = 0) {
  const source = String(text || '');
  const needle = String(value || '').trim();
  if (!needle) return null;

  const start = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), startAt);
  if (start < 0) return null;
  return {
    character_start: start,
    character_end: start + needle.length,
    quoted_text: source.slice(start, start + needle.length)
  };
}

function evidenceForText(text, value) {
  const span = findTextSpan(text, value);
  return span ? [span] : [];
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function extractJsonSections(value, prefix = 'root') {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      title: `${prefix}[${index}]`,
      content: typeof item === 'string' ? item : JSON.stringify(item),
      type: 'json-array-item'
    }));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({
      title: key,
      content: typeof item === 'string' ? item : JSON.stringify(item),
      type: 'json-field'
    }));
  }

  return [{ title: prefix, content: String(value || ''), type: 'json-scalar' }];
}

function parseContent(mimeType, rawText, sourceTitle = 'Document') {
  const type = String(mimeType || '').toLowerCase().split(';')[0];
  const text = Buffer.isBuffer(rawText) ? rawText.toString('utf8') : String(rawText || '');

  if (type.includes('html')) {
    const $ = cheerio.load(text);
    const title = $('title').first().text() || $('h1').first().text() || sourceTitle;
    const sections = [];
    $('h1, h2, h3, p, li').each((index, element) => {
      const content = cleanText($(element).text());
      if (!content) return;
      sections.push({ title: $(element).get(0).tagName.toUpperCase(), content, type: 'html-section' });
    });
    const paragraphs = $('body')
      .text()
      .split(/\s*\n\s*\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      title,
      mimeType: type,
      text: $('body').text(),
      sections: sections.length ? sections : [{ title: 'body', content: $('body').text(), type: 'html-body' }],
      chunks: paragraphs.length ? paragraphs.map((part, index) => ({ sequence: index + 1, content: part, location_metadata: { type: 'html-text' } })) : [{ sequence: 1, content: $('body').text(), location_metadata: { type: 'html-text' } }],
      sourceType: 'html'
    };
  }

  if (type.includes('json')) {
    const value = safeJsonParse(text) || {};
    const compact = JSON.stringify(value, null, 2);
    const sections = extractJsonSections(value, 'document');
    return {
      title: sourceTitle,
      mimeType: type,
      text: compact,
      sections,
      chunks: [{ sequence: 1, content: compact, location_metadata: { type: 'json' } }],
      sourceType: 'json'
    };
  }

  if (type.includes('csv')) {
    const rows = parse(text, { columns: true, skip_empty_lines: true });
    const content = rows.length ? rows.map((row) => JSON.stringify(row)).join('\n') : text;
    return {
      title: sourceTitle,
      mimeType: type,
      text: content,
      sections: rows.length ? [{ title: 'table_rows', content: JSON.stringify(rows.slice(0, 10)), type: 'csv-table' }] : [{ title: 'csv', content: text, type: 'csv-text' }],
      chunks: [{ sequence: 1, content, location_metadata: { type: 'csv' } }],
      sourceType: 'csv'
    };
  }

  if (type.includes('markdown') || type.includes('text') || type.includes('plain')) {
    const normalized = text.replace(/\r/g, '');
    const paragraphs = splitIntoParagraphs(normalized);
    const sections = paragraphs.map((paragraph, index) => ({
      title: `section_${index + 1}`,
      content: paragraph,
      type: 'text-paragraph'
    }));
    const content = paragraphs.join('\n\n');
    const title = titleFromText(normalized, sourceTitle);
    return {
      title,
      mimeType: type,
      text: content,
      sections: sections.length ? sections : [{ title: 'body', content: normalized, type: 'text-body' }],
      chunks: paragraphs.length ? paragraphs.map((part, index) => ({ sequence: index + 1, content: part, location_metadata: { type: 'text' } })) : [{ sequence: 1, content: content, location_metadata: { type: 'text' } }],
      sourceType: 'text'
    };
  }

  const paragraphs = splitIntoParagraphs(text);
  const title = titleFromText(text, sourceTitle);
  return {
    title,
    mimeType: type,
    text,
    sections: paragraphs.length ? paragraphs.map((part, index) => ({ title: `section_${index + 1}`, content: part, type: 'generic-section' })) : [{ title: 'body', content: text, type: 'generic-body' }],
    chunks: paragraphs.length ? paragraphs.map((part, index) => ({ sequence: index + 1, content: part, location_metadata: { type: 'generic' } })) : [{ sequence: 1, content: text, location_metadata: { type: 'generic' } }],
    sourceType: 'generic'
  };
}

async function parseUploadedContent(fileBuffer, mimeType, sourceTitle = 'Document') {
  const type = String(mimeType || '').toLowerCase().split(';')[0];

  if (type.includes('pdf')) {
    const parsed = await pdfParse(fileBuffer);
    const text = parsed.text || '';
    const paragraphs = splitIntoParagraphs(text);
    return {
      title: titleFromText(text, sourceTitle),
      mimeType: type,
      text,
      sections: paragraphs.length ? paragraphs.map((part, index) => ({ title: `pdf_section_${index + 1}`, content: part, type: 'pdf-section' })) : [{ title: 'pdf_body', content: text, type: 'pdf-body' }],
      chunks: paragraphs.map((part, index) => ({ sequence: index + 1, content: part, location_metadata: { page: index + 1, type: 'pdf' } })),
      sourceType: 'pdf'
    };
  }

  const text = fileBuffer.toString('utf8');
  return parseContent(type || 'text/plain', text, sourceTitle);
}

async function parseDocument(fileBuffer, mimeType, sourceTitle = 'Document') {
  const type = String(mimeType || '').toLowerCase().split(';')[0];
  const parsed = await parseUploadedContent(fileBuffer, mimeType, sourceTitle);
  const structured = extractStructuredContent(parsed.text);
  return {
    ...parsed,
    entities: structured.entities,
    claims: structured.claims,
    observations: structured.observations,
    relationships: structured.relationships,
    summary: parsed.text.slice(0, 280) || 'No summary available.',
    graph: {
      entities: structured.entities,
      relationships: structured.relationships,
      observations: structured.observations
    }
  };
}

function dedupeList(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(keyFn(item) || '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractStructuredContent(documentText) {
  const text = String(documentText || '');
  const entityNames = new Set();
  const relationships = [];
  const claims = [];
  const observations = [];

  const predicateMap = {
    administers: 'ADMINISTERS',
    funds: 'FUNDS',
    regulates: 'REGULATES',
    governs: 'GOVERNS',
    requires: 'REQUIRES',
    serves: 'SERVES',
    affects: 'AFFECTS',
    supports: 'SUPPORTS',
    contradicts: 'CONTRADICTS',
    supersedes: 'SUPERSEDES',
    amends: 'AMENDS',
    implements: 'IMPLEMENTS',
    enforces: 'ENFORCES',
    reduces: 'REDUCES',
    reduced: 'REDUCES',
    increases: 'INCREASES',
    increased: 'INCREASES',
    improves: 'IMPROVES',
    changes: 'CHANGES',
    'depends on': 'DEPENDS_ON',
    'relies on': 'RELIES_ON',
    'interacts with': 'INTERACTS_WITH'
  };

  function inferEntityType(label) {
    const value = String(label || '').toLowerCase();
    if (/regulation|rule|statute|law|mandate/.test(value)) return 'REGULATION';
    if (/agency|department|commission|board|office|administration|authority|bureau/.test(value)) return 'AGENCY';
    if (/program|service|initiative|benefit/.test(value)) return 'PROGRAM';
    if (/court|system|institution|government/.test(value)) return 'INSTITUTION';
    if (/family|families|children|workers|households|patients|veterans|students|population/.test(value)) return 'POPULATION';
    if (/state|county|city|district|region|country|minnesota|california|texas|florida|new york/.test(value)) return 'JURISDICTION';
    if (/poverty|unemployment|income|rate|cost|participation|outcome|effect/.test(value)) return 'MEASUREMENT';
    return 'ENTITY';
  }

  function cleanEntityPhrase(value) {
    return String(value || '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/^(?:under|according to|pursuant to)\s+[^,]+,\s*/i, '')
      .replace(/\s+(?:for|among|within|in|if|when|subject to)\s+.*$/i, '')
      .replace(/[.]+$/, '')
      .trim();
  }

  function extractContext(sentence) {
    const context = {};
    const jurisdictionMatch = sentence.match(/(?:under|within|in)\s+((?:the\s+)?[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)\s+(?:law|laws|regulation|regulations|jurisdiction|state|county)?/i);
    if (jurisdictionMatch) context.jurisdiction = jurisdictionMatch[1].trim();

    const dates = [...sentence.matchAll(/\b(?:19|20)\d{2}(?:-\d{2}-\d{2})?\b/g)].map((match) => match[0]);
    if (dates.length) context.temporal = { dates, valid_from: dates[0], valid_to: dates.length > 1 ? dates[1] : null };

    const populationMatch = sentence.match(/(?:for|among|serving|affecting)\s+([^,.]+(?:families|children|workers|households|patients|veterans|students|population|residents))/i);
    if (populationMatch) context.population = populationMatch[1].trim();

    const conditionMatch = sentence.match(/(?:if|when|provided that|subject to|eligibility depends on)\s+([^,.]+(?:\.|$))/i);
    if (conditionMatch) context.conditions = conditionMatch[1].trim().replace(/[.]+$/, '');
    return context;
  }

  const jsonValue = safeJsonParse(text);
  const relationshipKeyMap = {
    affects: 'AFFECTS',
    dependson: 'DEPENDS_ON',
    depends_on: 'DEPENDS_ON',
    relieson: 'RELIES_ON',
    relies_on: 'RELIES_ON',
    supports: 'SUPPORTS',
    interactswith: 'INTERACTS_WITH',
    interacts_with: 'INTERACTS_WITH',
    requires: 'REQUIRES'
  };

  function addStructuredRelationship(sourceName, key, targetValue) {
    const cleanSource = String(sourceName || '').trim();
    const cleanTarget = String(targetValue || '').trim();
    if (!cleanSource || !cleanTarget) return;
    const normalizedKey = String(key || '').replace(/[^a-z_]/gi, '').toLowerCase();
    const relType = relationshipKeyMap[normalizedKey] || normalizedKey.toUpperCase();
    relationships.push({
      relationship_type: relType,
      source_entity: cleanSource,
      target_entity: cleanTarget,
      attributes: { source: 'structured-json' }
    });
  }

  function visitStructuredObject(value, parentName = 'root') {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach((item, index) => visitStructuredObject(item, `${parentName}[${index}]`));
      return;
    }

    const recordName = value.name || value.title || value.label || value.id || value.entity || parentName;
    if (recordName && typeof recordName === 'string') {
      entityNames.add(recordName.trim());
    }

    for (const [key, itemValue] of Object.entries(value)) {
      const normalizedKey = String(key).replace(/[^a-z_]/gi, '').toLowerCase();
      const keyName = String(key).trim();

      if (typeof itemValue === 'string' && keyName && (normalizedKey === 'affects' || normalizedKey === 'depends_on' || normalizedKey === 'relies_on' || normalizedKey === 'supports' || normalizedKey === 'requires' || normalizedKey === 'interacts_with')) {
        addStructuredRelationship(recordName || parentName, keyName, itemValue);
      }

      if (typeof itemValue === 'object' && itemValue !== null) {
        visitStructuredObject(itemValue, recordName || keyName);
      }
    }
  }

  if (jsonValue && typeof jsonValue === 'object') {
    visitStructuredObject(jsonValue, 'document');
  }

  const entityCandidates = [
    ...(text.match(/(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g) || []),
    ...(text.match(/(?:Agency|Program|Regulation|Law|Department|County|State|Population)\s+[A-Z][A-Za-z0-9-]*/g) || []),
    ...(text.match(/(?:Child Support Program|Court Systems|Unemployment|families|poverty|program)/gi) || []),
    ...(text.match(/(?:[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})/g) || [])
  ];

  for (const candidate of entityCandidates) {
    const clean = candidate.trim();
    if (clean.length > 1 && /^(?:under|according|source)\b/i.test(clean) === false) {
      entityNames.add(clean.toLowerCase());
    }
  }

  const entities = dedupeList([...entityNames].map((entry) => {
    const label = entry.replace(/\s+/g, ' ').trim();
    const canonical = label.charAt(0).toUpperCase() + label.slice(1);
    const type = inferEntityType(canonical);
    return { type, canonical_name: canonical, attributes: { source: 'rule-based-candidate', confidence: 0.55 } };
  }), (entity) => `${entity.type}|${entity.canonical_name}`);

  const sentenceMatches = [...text.matchAll(/[^.!?]+[.!?]?/g)];
  for (const sentenceMatch of sentenceMatches) {
    const sentence = sentenceMatch[0];
    const normalizedSentence = sentence.trim();
    if (!normalizedSentence) continue;
    const sentenceEvidence = evidenceForText(text, normalizedSentence);
    const context = extractContext(normalizedSentence);

    const sourceStatement = normalizedSentence.match(/^(?:Source|Study|Report)\s+([A-Za-z0-9_-]+)\s+(?:says|reports|finds|states)\s+(.+)$/i);
    if (sourceStatement) {
      const sourceReference = sourceStatement[1];
      const reportedText = sourceStatement[2].split(/\s+while\s+(?:Source|Study|Report)\b/i)[0].replace(/[.]+$/, '');
      const reportedMatch = reportedText.match(/(.+?)\s+(reduced|increased|reduces|increases|affects|supports|contradicts)\s+(.+)/i);
      const sourceAttributes = {
        source_sentence: normalizedSentence,
        evidence: sentenceEvidence,
        context,
        source_reference: sourceReference,
        source_role: 'reported_assertion'
      };
      if (reportedMatch) {
        claims.push({
          claim_type: 'source_assertion',
          subject: cleanEntityPhrase(reportedMatch[1]),
          predicate: predicateMap[reportedMatch[2].toLowerCase()] || reportedMatch[2].toUpperCase(),
          object: cleanEntityPhrase(reportedMatch[3]),
          attributes: sourceAttributes
        });
      } else {
        claims.push({
          claim_type: 'source_assertion',
          subject: claims.length ? claims[claims.length - 1].subject : 'Document',
          predicate: /no statistically significant effect/i.test(reportedText) ? 'NO_STATISTICALLY_SIGNIFICANT_EFFECT' : 'REPORTS',
          object: reportedText,
          attributes: sourceAttributes
        });
      }

      const secondarySource = normalizedSentence.match(/\bwhile\s+(?:Source|Study|Report)\s+([A-Za-z0-9_-]+)\s+(?:says|reports|finds|states)\s+(.+)$/i);
      if (secondarySource) {
        const secondaryText = secondarySource[2].replace(/[.]+$/, '');
        claims.push({
          claim_type: 'source_assertion',
          subject: claims.length ? claims[claims.length - 1].subject : 'Document',
          predicate: /no statistically significant effect/i.test(secondaryText) ? 'NO_STATISTICALLY_SIGNIFICANT_EFFECT' : 'REPORTS',
          object: secondaryText,
          attributes: {
            source_sentence: normalizedSentence,
            evidence: sentenceEvidence,
            context,
            source_reference: secondarySource[1],
            source_role: 'reported_assertion'
          }
        });
      }
    }

    const claimPatterns = [
      new RegExp(`(.*?)(?:${Object.keys(predicateMap).join('|')})\\s+(.+)`, 'i'),
      /(.*?)\s+(?:was|were)\s+(?:amended|superseded|repealed)\s+(?:in|by)\s+(.+)/i
    ];

    for (const pattern of claimPatterns) {
      const match = sourceStatement ? null : normalizedSentence.match(pattern);
      if (match) {
        const matchedPredicate = Object.keys(predicateMap).find((candidate) => new RegExp(`\\b${candidate}\\b`, 'i').test(match[0]));
        const subject = cleanEntityPhrase(match[1]) || 'Unknown subject';
        const predicate = matchedPredicate ? predicateMap[matchedPredicate] : (/amended/i.test(match[0]) ? 'AMENDED_IN' : /superseded/i.test(match[0]) ? 'SUPERSEDED_BY' : 'RELATES_TO');
        const object = cleanEntityPhrase(match[2]) || 'Unknown object';
        claims.push({ claim_type: 'claim', subject, predicate, object, attributes: { source_sentence: normalizedSentence, evidence: sentenceEvidence, context } });
      }
    }

    const percentMatch = normalizedSentence.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      const value = percentMatch[1];
      const subject = normalizedSentence.replace(percentMatch[0], '').replace(/^(?:The|A|An)\s+/i, '').trim() || 'Unknown subject';
      observations.push({ observation_type: 'statistic', subject, value, unit: '%', attributes: { source_sentence: normalizedSentence, evidence: sentenceEvidence, context } });
    }

    const relationshipMatch = normalizedSentence.match(new RegExp(`(.+?)\\s+(${Object.keys(predicateMap).join('|')})\\s+(.+)`, 'i'));
    if (relationshipMatch) {
      relationships.push({
        relationship_type: predicateMap[relationshipMatch[2].toLowerCase()] || relationshipMatch[2].toUpperCase().replace(/\s+/g, '_'),
        source_entity: cleanEntityPhrase(relationshipMatch[1]),
        target_entity: cleanEntityPhrase(relationshipMatch[3]),
        attributes: { source_sentence: normalizedSentence, evidence: sentenceEvidence, context }
      });
    }
  }

  if (!claims.length) {
    const generic = text.split(/(?<=[.!?])\s+/)[0];
    if (generic) {
      claims.push({ claim_type: 'claim', subject: 'Document', predicate: 'DESCRIBES', object: generic.slice(0, 160), attributes: { source_sentence: generic, evidence: evidenceForText(text, generic) } });
    }
  }

  if (!observations.length) {
    const numeric = text.match(/(\d+(?:\.\d+)?(?:%|million|billion|thousand)?)/g) || [];
    for (const value of numeric.slice(0, 2)) {
      observations.push({ observation_type: 'statistic', subject: 'Document', value, unit: value.includes('%') ? '%' : 'measure', attributes: { source_text: text.slice(0, 160), evidence: evidenceForText(text, text.slice(0, 160)) } });
    }
  }

  return {
    entities: dedupeList(entities, (entity) => `${entity.type}|${entity.canonical_name}`),
    claims: dedupeList(claims, (claim) => `${claim.subject}|${claim.predicate}|${claim.object}`),
    observations: dedupeList(observations, (observation) => `${observation.subject}|${observation.value}|${observation.unit}`),
    relationships: dedupeList(relationships, (relationship) => `${relationship.relationship_type}|${relationship.source_entity}|${relationship.target_entity}`)
  };
}

function buildAiContextBundle(document) {
  const base = document && typeof document === 'object' ? document : { title: 'Document', text: String(document || ''), sourceType: 'text' };
  const text = String(base.text || '');
  const structured = extractStructuredContent(text);
  const entities = dedupeList([...(base.entities || []), ...structured.entities], (entity) => `${entity.type}|${entity.canonical_name}`);
  const relationships = dedupeList([...(base.relationships || []), ...structured.relationships], (relationship) => `${relationship.relationship_type}|${relationship.source_entity}|${relationship.target_entity}`);
  const observations = dedupeList([...(base.observations || []), ...structured.observations], (observation) => `${observation.subject}|${observation.value}|${observation.unit}`);
  const summaryText = text ? text.slice(0, 220).replace(/\s+/g, ' ').trim() : 'No content available.';

  return {
    title: base.title || 'Untitled document',
    sourceType: base.sourceType || 'text',
    summary: summaryText,
    compactContext: {
      title: base.title || 'Untitled document',
      type: base.sourceType || 'text',
      summary: summaryText,
      entities: entities.slice(0, 12).map((entity) => entity.canonical_name || entity.name || entity.type),
      relationships: relationships.slice(0, 12).map((relationship) => ({
        type: relationship.relationship_type,
        from: relationship.source_entity,
        to: relationship.target_entity
      })),
      observations: observations.slice(0, 8).map((observation) => ({
        subject: observation.subject,
        value: observation.value,
        unit: observation.unit
      }))
    },
    entities,
    relationships,
    observations,
    claims: dedupeList([...(base.claims || []), ...structured.claims], (claim) => `${claim.subject}|${claim.predicate}|${claim.object}`)
  };
}

function normalizeGraphKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'node';
}

function inferOntologyType(label, fallback = 'ENTITY') {
  const value = String(label || '').trim();
  if (!value) return fallback;
  const text = value.toLowerCase();

  if (/department|agency|commission|board|office|ministry|administration|authority|bureau/i.test(text)) {
    return 'AGENCY';
  }
  if (/service|program|initiative|benefit|support|care|programs/i.test(text)) {
    return 'SERVICE';
  }
  if (/policy|regulation|rule|law|mandate|statute|guideline/i.test(text)) {
    return 'POLICY';
  }
  if (/family|families|children|workers|population|citizens|households|patients|veterans|students/i.test(text)) {
    return 'POPULATION';
  }
  if (/state|county|city|district|region|country|california|texas|florida|new york|geography/i.test(text)) {
    return 'GEOGRAPHY';
  }
  if (/outcome|impact|result|effect|benefit|risk|access|quality|cost/i.test(text)) {
    return 'OUTCOME';
  }
  if (/dependency|depends on|requires|relies on|pathway|flow|connection|infrastructure/i.test(text)) {
    return 'DEPENDENCY';
  }
  if (/system|network|platform|infrastructure|court|agency|department/i.test(text)) {
    return 'SYSTEM';
  }
  if (/measure|metric|rate|percent|poverty|unemployment|income|employment|population/i.test(text)) {
    return 'MEASUREMENT';
  }
  return fallback;
}

function buildKnowledgeBaseGraph(records = {}) {
  const entities = Array.isArray(records.entities) ? records.entities : [];
  const relationships = Array.isArray(records.relationships) ? records.relationships : [];
  const claims = Array.isArray(records.claims) ? records.claims : [];
  const observations = Array.isArray(records.observations) ? records.observations : [];
  const propositions = Array.isArray(records.propositions) ? records.propositions : [];
  const states = Array.isArray(records.states) ? records.states : [];
  const events = Array.isArray(records.events) ? records.events : [];
  const rules = Array.isArray(records.rules) ? records.rules : [];
  const mechanisms = Array.isArray(records.mechanisms) ? records.mechanisms : [];
  const canonicalEntities = Array.isArray(records.canonical_entities) ? records.canonical_entities : [];
  const sources = Array.isArray(records.sources) ? records.sources : [];

  const nodeMap = new Map();

  function addNode(name, kind = 'ENTITY', attributes = {}) {
    const label = String(name || '').trim();
    if (!label) return null;
    const key = normalizeGraphKey(label);
    const ontologyType = inferOntologyType(label, kind);
    if (!nodeMap.has(key)) {
      nodeMap.set(key, {
        id: `node:${key}`,
        label,
        type: kind,
        ontologyType,
        aliases: [label],
        attributes,
        layer: 'knowledge-base'
      });
    } else {
      const existing = nodeMap.get(key);
      if (!existing.aliases.includes(label)) {
        existing.aliases.push(label);
      }
      existing.type = kind || existing.type;
      existing.ontologyType = ontologyType || existing.ontologyType;
      if (Object.keys(attributes).length) {
        existing.attributes = { ...existing.attributes, ...attributes };
      }
    }
    return nodeMap.get(key);
  }

  for (const entity of entities) {
    const label = entity.canonical_name || entity.name || entity.label || entity.type || 'Unknown entity';
    const inferredType = entity.type || inferOntologyType(label, 'ENTITY');
    addNode(label, inferredType, entity.attributes || {});
  }

  const entityLabelsById = new Map(canonicalEntities.map((entity) => [entity.id, entity.canonical_name]));

  for (const proposition of propositions) {
    const subject = proposition.subject_text || entityLabelsById.get(proposition.subject_entity_id) || 'Unknown subject';
    const object = proposition.object_text || entityLabelsById.get(proposition.object_entity_id) || 'Unknown object';
    addNode(subject, inferOntologyType(subject, 'PROPOSITION_SUBJECT'), { source: 'proposition' });
    addNode(object, inferOntologyType(object, 'PROPOSITION_OBJECT'), { source: 'proposition' });
  }

  for (const state of states) {
    const subject = entityLabelsById.get(state.subject_entity_id) || state.subject || 'Unknown state subject';
    addNode(subject, inferOntologyType(subject, 'STATE_SUBJECT'), { source: 'state', state_type: state.state_type });
  }

  for (const event of events) {
    const subject = entityLabelsById.get(event.subject_entity_id) || 'Unknown event subject';
    const object = entityLabelsById.get(event.object_entity_id) || 'Unknown event object';
    addNode(subject, inferOntologyType(subject, 'EVENT_SUBJECT'), { source: 'event' });
    addNode(object, inferOntologyType(object, 'EVENT_OBJECT'), { source: 'event' });
  }

  for (const rule of rules) {
    const subject = entityLabelsById.get(rule.subject_entity_id) || 'Unknown rule subject';
    const object = entityLabelsById.get(rule.object_entity_id) || 'Unknown rule object';
    addNode(subject, inferOntologyType(subject, 'RULE_SUBJECT'), { source: 'rule', status: rule.status });
    addNode(object, inferOntologyType(object, 'RULE_OBJECT'), { source: 'rule' });
  }

  for (const mechanism of mechanisms) {
    const sourceName = entityLabelsById.get(mechanism.source_entity_id) || 'Unknown mechanism source';
    const targetName = entityLabelsById.get(mechanism.target_entity_id) || 'Unknown mechanism target';
    addNode(sourceName, inferOntologyType(sourceName, 'MECHANISM_SOURCE'), { source: 'mechanism' });
    addNode(targetName, inferOntologyType(targetName, 'MECHANISM_TARGET'), { source: 'mechanism' });
  }

  for (const relationship of relationships) {
    const sourceName = relationship.source_entity || relationship.source || 'Unknown source';
    const targetName = relationship.target_entity || relationship.target || 'Unknown target';
    addNode(sourceName, inferOntologyType(sourceName, 'ENTITY'), { source: 'relationship' });
    addNode(targetName, inferOntologyType(targetName, 'ENTITY'), { source: 'relationship' });
  }

  for (const claim of claims) {
    addNode(claim.subject || 'Unknown subject', inferOntologyType(claim.subject || 'Unknown subject', 'CLAIM_SUBJECT'), { source: 'claim' });
    addNode(claim.object || 'Unknown object', inferOntologyType(claim.object || 'Unknown object', 'CLAIM_OBJECT'), { source: 'claim' });
  }

  for (const observation of observations) {
    addNode(observation.subject || 'Unknown subject', inferOntologyType(observation.subject || 'Unknown subject', 'OBSERVATION_SUBJECT'), { source: 'observation' });
  }

  const nodes = [...nodeMap.values()];

  const edges = relationships.map((relationship, index) => {
    const sourceName = relationship.source_entity || relationship.source || 'Unknown source';
    const targetName = relationship.target_entity || relationship.target || 'Unknown target';
    const sourceId = `node:${normalizeGraphKey(sourceName)}`;
    const targetId = `node:${normalizeGraphKey(targetName)}`;
    return {
      id: `edge:${index + 1}`,
      source: sourceId,
      target: targetId,
      type: String(relationship.relationship_type || relationship.type || 'RELATES_TO').toUpperCase(),
      weight: 0.7,
      attributes: relationship.attributes || {},
      evidence: [relationship.source_sentence || relationship.attributes || {}]
    };
  });

  const canonicalEdges = [
    ...propositions.map((proposition, index) => ({
      id: `proposition:${proposition.id || index + 1}`,
      source: `node:${normalizeGraphKey(proposition.subject_text || entityLabelsById.get(proposition.subject_entity_id) || 'Unknown subject')}`,
      target: `node:${normalizeGraphKey(proposition.object_text || entityLabelsById.get(proposition.object_entity_id) || 'Unknown object')}`,
      type: String(proposition.predicate || 'ASSERTS').toUpperCase(),
      weight: 0.8,
      attributes: { source: 'proposition', context_id: proposition.context_id },
      evidence: proposition.attributes || {}
    })),
    ...mechanisms.map((mechanism, index) => ({
      id: `mechanism:${mechanism.id || index + 1}`,
      source: `node:${normalizeGraphKey(entityLabelsById.get(mechanism.source_entity_id) || 'Unknown mechanism source')}`,
      target: `node:${normalizeGraphKey(entityLabelsById.get(mechanism.target_entity_id) || 'Unknown mechanism target')}`,
      type: String(mechanism.mechanism_type || 'MECHANISM').toUpperCase(),
      weight: mechanism.strength || mechanism.confidence || 0.7,
      attributes: { ...mechanism.attributes, context_id: mechanism.context_id, polarity: mechanism.polarity, certainty: mechanism.certainty },
      evidence: mechanism.attributes || {}
    })),
    ...events.map((event, index) => ({
      id: `event:${event.id || index + 1}`,
      source: `node:${normalizeGraphKey(entityLabelsById.get(event.subject_entity_id) || 'Unknown event subject')}`,
      target: `node:${normalizeGraphKey(entityLabelsById.get(event.object_entity_id) || 'Unknown event object')}`,
      type: String(event.event_type || 'EVENT').toUpperCase(),
      weight: 0.8,
      attributes: event.attributes || {},
      evidence: event.attributes || {}
    }))
  ];

  return {
    schemaVersion: '1.0',
    title: 'C3 system knowledge base',
    description: 'Canonical graph-ready knowledge layer for AI reasoning and system mapping.',
    nodes,
    edges: [...edges, ...canonicalEdges],
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length + canonicalEdges.length,
      claimCount: claims.length,
      observationCount: observations.length,
      relationshipCount: relationships.length,
      propositionCount: propositions.length,
      stateCount: states.length,
      eventCount: events.length,
      ruleCount: rules.length,
      mechanismCount: mechanisms.length,
      sourceCount: sources.length
    }
  };
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

module.exports = {
  parseContent,
  parseUploadedContent,
  parseDocument,
  buildAiContextBundle,
  buildKnowledgeBaseGraph,
  extractStructuredContent,
  hashContent,
  normalizeWhitespace,
  splitIntoParagraphs
};
