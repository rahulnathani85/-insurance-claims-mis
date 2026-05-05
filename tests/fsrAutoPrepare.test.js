// =============================================================================
// tests/fsrAutoPrepare.test.js
// =============================================================================
// Pure-logic tests for the FSR Auto-Prepare prompt + parser + merge helpers.
// Mocks no LLM — these helpers don't make network calls.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildAutoPreparePrompt,
  parseAutoPrepareJson,
  mergeIntoNarrative,
  flattenSchema,
  SYSTEM_PROMPT,
} from '../lib/fsr/narrativeAutoPreparePrompt.js';
import { fieldsForLob } from '../lib/fsr/narrativeFields.js';

// Real schema we ship in production for the Ultratech FSR.
const ULT_SCHEMA = fieldsForLob('Marine Cargo', 'Ultratech_Marine_Cargo_v1');

// ============================================================================
// flattenSchema
// ============================================================================

describe('flattenSchema', () => {
  it('flattens sections into a flat list with sectionTitle attached', () => {
    const flat = flattenSchema([
      { title: 'A', fields: [{ key: 'a1' }, { key: 'a2' }] },
      { title: 'B', fields: [{ key: 'b1' }] },
    ]);
    expect(flat.map((f) => f.key)).toEqual(['a1', 'a2', 'b1']);
    expect(flat[0].sectionTitle).toBe('A');
    expect(flat[2].sectionTitle).toBe('B');
  });

  it('returns [] for non-array input', () => {
    expect(flattenSchema(null)).toEqual([]);
    expect(flattenSchema(undefined)).toEqual([]);
    expect(flattenSchema('not array')).toEqual([]);
  });

  it('skips sections whose fields is missing or non-array', () => {
    const flat = flattenSchema([
      { title: 'A', fields: [{ key: 'a1' }] },
      { title: 'B' },
      { title: 'C', fields: 'oops' },
    ]);
    expect(flat.length).toBe(1);
  });
});

// ============================================================================
// buildAutoPreparePrompt
// ============================================================================

describe('buildAutoPreparePrompt', () => {
  function baseClaim() {
    return {
      id: 487,
      ref_number: 'UTCL-002/26-27',
      claim_number: '4300243430',
      insurer_name: 'Tata AIG General Insurance Co. Ltd.',
      insured_name: 'M/s Ultratech Cement Ltd.',
      policy_number: '0865107728',
      policy_period_from: '2026-04-03',
      policy_period_to: '2026-04-02',
      lob: 'Marine Cargo',
      date_loss: '2026-04-08',
      date_of_intimation: '2026-04-14',
      loss_location: 'Bareilly Railway Siding',
      company: 'NISLA',
    };
  }

  it('throws on missing or empty schema', () => {
    expect(() => buildAutoPreparePrompt({ schema: null, claim: baseClaim() })).toThrow();
    expect(() => buildAutoPreparePrompt({ schema: [], claim: baseClaim() })).toThrow();
  });

  it('mentions every field key from the resolved schema', () => {
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [],
      intimationBody: '',
    });
    const allKeys = ULT_SCHEMA.flatMap((s) => s.fields.map((f) => f.key));
    for (const k of allKeys) {
      expect(userMessage).toContain('`' + k + '`');
    }
  });

  it('declares array fields with their column shape', () => {
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [],
      intimationBody: '',
    });
    expect(userMessage).toMatch(/`damaged_items` \(array of objects/);
    // Should mention the columns of damaged_items.
    expect(userMessage).toContain('invoice_no(text)');
    expect(userMessage).toContain('damaged_bags(number)');
  });

  it('embeds OCR docs in the evidence section', () => {
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [
        { filename: 'RR.pdf', mime_type: 'application/pdf', ocr_text: 'RR No: 262002250 Consignor: Ultratech' },
      ],
      intimationBody: '',
    });
    expect(userMessage).toContain('RR.pdf');
    expect(userMessage).toContain('262002250');
  });

  it('embeds the intimation email body', () => {
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [],
      intimationBody: 'A claim has been reported. Estimated loss: 80000.',
    });
    expect(userMessage).toContain('Intimation email body');
    expect(userMessage).toContain('Estimated loss: 80000');
  });

  it('shows a clear placeholder when no docs are uploaded', () => {
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [],
      intimationBody: '',
    });
    expect(userMessage).toMatch(/No documents uploaded against this claim/);
  });

  it('truncates very long OCR text without crashing', () => {
    const longText = 'A'.repeat(50000);
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [{ filename: 'huge.pdf', mime_type: 'application/pdf', ocr_text: longText }],
      intimationBody: '',
    });
    expect(userMessage.length).toBeLessThan(60000);
    expect(userMessage).toMatch(/truncated/);
  });

  it('serialises the claim row in JSON', () => {
    const { userMessage } = buildAutoPreparePrompt({
      schema: ULT_SCHEMA,
      claim: baseClaim(),
      templateName: 'Ultratech_Marine_Cargo_v1',
      ocrDocs: [],
      intimationBody: '',
    });
    expect(userMessage).toContain('"ref_number": "UTCL-002/26-27"');
    expect(userMessage).toContain('"insured_name": "M/s Ultratech Cement Ltd."');
  });

  it('SYSTEM_PROMPT enforces the JSON-only contract', () => {
    expect(SYSTEM_PROMPT).toMatch(/JSON ONLY/);
    expect(SYSTEM_PROMPT).toMatch(/values/);
    expect(SYSTEM_PROMPT).toMatch(/sources/);
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent data/i);
  });
});

// ============================================================================
// parseAutoPrepareJson
// ============================================================================

describe('parseAutoPrepareJson', () => {
  const valid = JSON.stringify({
    values: { consignor_name: 'M/s Ultratech', rr_no: '262002250' },
    sources: { consignor_name: 'rr', rr_no: 'rr' },
    notes: null,
  });

  it('parses clean JSON', () => {
    const r = parseAutoPrepareJson(valid);
    expect(r.values.consignor_name).toBe('M/s Ultratech');
    expect(r.sources.rr_no).toBe('rr');
    expect(r.notes).toBeNull();
  });

  it('strips ```json fences', () => {
    const r = parseAutoPrepareJson('```json\n' + valid + '\n```');
    expect(r.values.rr_no).toBe('262002250');
  });

  it('strips bare ``` fences', () => {
    const r = parseAutoPrepareJson('```\n' + valid + '\n```');
    expect(r.values.rr_no).toBe('262002250');
  });

  it('falls back to extracting last { ... } on a stray preamble', () => {
    const r = parseAutoPrepareJson("Here's the result:\n" + valid);
    expect(r.values.rr_no).toBe('262002250');
  });

  it('throws on empty input', () => {
    expect(() => parseAutoPrepareJson('')).toThrow(/empty/);
    expect(() => parseAutoPrepareJson('   ')).toThrow(/empty/);
  });

  it('throws on unparseable garbage', () => {
    expect(() => parseAutoPrepareJson('not json at all')).toThrow();
  });

  it('returns empty defaults when values/sources are missing', () => {
    const r = parseAutoPrepareJson(JSON.stringify({}));
    expect(r.values).toEqual({});
    expect(r.sources).toEqual({});
    expect(r.notes).toBeNull();
  });

  it('rejects array as top-level', () => {
    expect(() => parseAutoPrepareJson('[1,2,3]')).toThrow(/not an object/);
  });

  it('preserves notes when string', () => {
    const r = parseAutoPrepareJson(JSON.stringify({ values: {}, notes: 'JIR was unreadable' }));
    expect(r.notes).toBe('JIR was unreadable');
  });

  it('drops non-object values/sources', () => {
    const r = parseAutoPrepareJson(JSON.stringify({ values: 'not obj', sources: [1, 2] }));
    expect(r.values).toEqual({});
    expect(r.sources).toEqual({});
  });
});

// ============================================================================
// mergeIntoNarrative
// ============================================================================

describe('mergeIntoNarrative', () => {
  const TINY_SCHEMA = [
    {
      title: 'Test',
      fields: [
        { key: 'consignor_name', type: 'text' },
        { key: 'rr_no', type: 'text' },
        { key: 'cargo_type', type: 'text' },
        {
          key: 'damaged_items',
          type: 'array',
          itemSchema: [
            { key: 'invoice_no', type: 'text' },
            { key: 'damaged_bags', type: 'number' },
          ],
        },
      ],
    },
  ];

  it('fills empty fields with the agent values', () => {
    const r = mergeIntoNarrative(
      {},
      { consignor_name: 'M/s Ultratech', rr_no: '262002250', cargo_type: null },
      TINY_SCHEMA
    );
    expect(r.merged.consignor_name).toBe('M/s Ultratech');
    expect(r.merged.rr_no).toBe('262002250');
    expect(r.merged.cargo_type).toBeUndefined(); // null skipped (no override of empty)
    expect(r.filled).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.dropped).toBe(0);
  });

  it('does not overwrite surveyor-typed values', () => {
    const r = mergeIntoNarrative(
      { consignor_name: 'My typed value', rr_no: '' },
      { consignor_name: 'Agent guess', rr_no: '262002250' },
      TINY_SCHEMA
    );
    expect(r.merged.consignor_name).toBe('My typed value'); // preserved
    expect(r.merged.rr_no).toBe('262002250');               // empty got filled
    expect(r.filled).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('drops keys not in the schema', () => {
    const r = mergeIntoNarrative(
      {},
      { rr_no: '262002250', not_in_schema: 'whatever', also_not: 42 },
      TINY_SCHEMA
    );
    expect(r.merged.not_in_schema).toBeUndefined();
    expect(r.merged.also_not).toBeUndefined();
    expect(r.dropped).toBe(2);
  });

  it('array: fills when empty, skips when surveyor has rows', () => {
    const r1 = mergeIntoNarrative(
      {},
      { damaged_items: [{ invoice_no: 'A', damaged_bags: 100 }] },
      TINY_SCHEMA
    );
    expect(r1.merged.damaged_items).toHaveLength(1);
    expect(r1.merged.damaged_items[0].invoice_no).toBe('A');
    expect(r1.filled).toBe(1);

    const r2 = mergeIntoNarrative(
      { damaged_items: [{ invoice_no: 'PRE', damaged_bags: 1 }] },
      { damaged_items: [{ invoice_no: 'AGENT', damaged_bags: 99 }] },
      TINY_SCHEMA
    );
    expect(r2.merged.damaged_items[0].invoice_no).toBe('PRE'); // preserved
    expect(r2.skipped).toBe(1);
  });

  it('array: drops columns not in itemSchema', () => {
    const r = mergeIntoNarrative(
      {},
      {
        damaged_items: [{
          invoice_no: 'A', damaged_bags: 100,
          extra_col: 'should be dropped',
          another: 'gone',
        }],
      },
      TINY_SCHEMA
    );
    expect(r.merged.damaged_items[0]).toEqual({ invoice_no: 'A', damaged_bags: 100 });
    expect(r.merged.damaged_items[0].extra_col).toBeUndefined();
  });

  it('array: missing required cols default to empty string', () => {
    const r = mergeIntoNarrative(
      {},
      { damaged_items: [{ invoice_no: 'A' }] }, // damaged_bags omitted
      TINY_SCHEMA
    );
    expect(r.merged.damaged_items[0]).toEqual({ invoice_no: 'A', damaged_bags: '' });
  });

  it('agent emits null for an array → fills as []', () => {
    const r = mergeIntoNarrative({}, { damaged_items: null }, TINY_SCHEMA);
    expect(r.merged.damaged_items).toEqual([]);
  });

  it('handles non-object existing input gracefully', () => {
    expect(mergeIntoNarrative(null,      { rr_no: 'X' }, TINY_SCHEMA).merged.rr_no).toBe('X');
    expect(mergeIntoNarrative(undefined, { rr_no: 'X' }, TINY_SCHEMA).merged.rr_no).toBe('X');
    expect(mergeIntoNarrative('string',  { rr_no: 'X' }, TINY_SCHEMA).merged.rr_no).toBe('X');
  });

  it('handles non-object agent input gracefully (no-op)', () => {
    const existing = { rr_no: 'PRE' };
    expect(mergeIntoNarrative(existing, null,      TINY_SCHEMA).merged).toEqual(existing);
    expect(mergeIntoNarrative(existing, undefined, TINY_SCHEMA).merged).toEqual(existing);
    expect(mergeIntoNarrative(existing, 'string',  TINY_SCHEMA).merged).toEqual(existing);
  });

  it('treats whitespace-only existing values as empty (so AI fills them)', () => {
    const r = mergeIntoNarrative(
      { rr_no: '   ' },
      { rr_no: '262002250' },
      TINY_SCHEMA
    );
    expect(r.merged.rr_no).toBe('262002250');
    expect(r.filled).toBe(1);
  });
});
