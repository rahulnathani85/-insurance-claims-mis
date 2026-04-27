// ============================================================
// tests/executor.test.js
// ------------------------------------------------------------
// Tests for lib/comms/executor.js — the auto-routing engine.
// We mock supabaseAdmin so each test controls exactly what the
// DB returns, then assert on what the executor decided.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------- Mocks ----------------

// In-memory state that mockBuilder reads from. Each test resets
// this to the rows it wants the DB to return.
const dbState = {
  inbox_messages: [],
  message_classifications: [],
  extraction_results: [],
  message_attachments: [],
  claims: [],
  routing_executions_inserted: [],
  inbox_messages_updates: [],
};

const tagDefs = {
  intimation: {
    tag: 'intimation',
    auto_route_threshold: 0.92,
    routing_actions: ['create_claim', 'link_to_claim'],
    extraction_schema: {},
  },
  client_followup: {
    tag: 'client_followup',
    auto_route_threshold: 0.85,
    routing_actions: ['link_to_claim'],
    extraction_schema: {},
  },
  settlement_advice: {
    tag: 'settlement_advice',
    auto_route_threshold: 0.93,
    routing_actions: ['link_to_claim', 'update_claim_settlement'],
    extraction_schema: {},
  },
};

function makeQueryBuilder(table) {
  // A chainable mock matching the supabase-js builder surface used
  // by executor.js. Resolves with { data, error } at the end.
  const filters = [];
  const updates = { value: null };
  const inserts = { value: null };
  let isUpdate = false;
  let isInsert = false;
  let limitN = null;

  const builder = {
    select: () => builder,
    insert: (rows) => { isInsert = true; inserts.value = rows; return builder; },
    update: (vals) => { isUpdate = true; updates.value = vals; return builder; },
    delete: () => builder,
    eq: (col, val) => { filters.push([col, val]); return builder; },
    in: () => builder,
    ilike: () => builder,
    order: () => builder,
    limit: (n) => { limitN = n; return builder; },
    maybeSingle: () => Promise.resolve(resolveQuery(table, filters, isUpdate, updates.value, isInsert, inserts.value, limitN, true)),
    single: () => Promise.resolve(resolveQuery(table, filters, isUpdate, updates.value, isInsert, inserts.value, limitN, true)),
    // Default await: array result
    then: (resolve) => resolve(resolveQuery(table, filters, isUpdate, updates.value, isInsert, inserts.value, limitN, false)),
  };
  return builder;
}

function resolveQuery(table, filters, isUpdate, updateVals, isInsert, insertVals, limitN, single) {
  // Inserts — capture for test assertion.
  if (isInsert && table === 'routing_executions') {
    dbState.routing_executions_inserted.push(...(Array.isArray(insertVals) ? insertVals : [insertVals]));
    return { data: null, error: null };
  }
  if (isInsert && table === 'claims') {
    const id = dbState.claims.length + 100;
    const newClaim = { id, ref_number: `CLM-NEW-${id}`, ...insertVals[0] };
    dbState.claims.push(newClaim);
    return { data: newClaim, error: null };
  }
  if (isInsert && table === 'claim_documents') {
    return { data: null, error: null };
  }
  if (isInsert) {
    return { data: null, error: null };
  }

  // Updates — capture so tests can assert.
  if (isUpdate && table === 'inbox_messages') {
    dbState.inbox_messages_updates.push({ filters, updateVals });
    return { data: null, error: null };
  }
  if (isUpdate) {
    return { data: null, error: null };
  }

  // Selects.
  let rows = dbState[table] || [];
  for (const [col, val] of filters) {
    rows = rows.filter((r) => r[col] === val);
  }
  if (limitN !== null) rows = rows.slice(0, limitN);
  if (single) {
    return { data: rows[0] || null, error: null };
  }
  return { data: rows, error: null };
}

const mockSupabaseAdmin = {
  from: (table) => makeQueryBuilder(table),
};

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

vi.mock('@/lib/observability', () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('@/lib/comms/auditLog', () => ({
  recordPortalActivity: vi.fn(),
}));

vi.mock('@/lib/comms/replyGenerator', () => ({
  generateReplyDraft: vi.fn(),
}));

// Override tag_definitions fetch by intercepting that specific table.
// Easier: return tagDefs from the regular query path.
function seedTagDefs() {
  dbState.tag_definitions = Object.values(tagDefs);
}

// ---------------- Tests ----------------

describe('executeRouting', () => {
  let executeRouting;

  beforeEach(async () => {
    // Reset state.
    Object.keys(dbState).forEach((k) => {
      if (Array.isArray(dbState[k])) dbState[k] = [];
    });
    seedTagDefs();
    vi.clearAllMocks();
    // Re-import so the module's tag cache resets between tests.
    vi.resetModules();
    const mod = await import('../lib/comms/executor.js');
    executeRouting = mod.executeRouting;
  });

  it('skips when message status is not pending_review', async () => {
    dbState.inbox_messages = [{
      id: 'msg-1', status: 'received', company: 'NISLA',
    }];

    const result = await executeRouting('msg-1');

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/expected 'pending_review'/);
  });

  it('skips when no active classification exists', async () => {
    dbState.inbox_messages = [{
      id: 'msg-2', status: 'pending_review', company: 'NISLA',
    }];
    // No classifications seeded.

    const result = await executeRouting('msg-2');

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/no active classification/);
  });

  it('skips when extraction is invalid', async () => {
    dbState.inbox_messages = [{
      id: 'msg-3', status: 'pending_review', company: 'NISLA',
    }];
    dbState.message_classifications = [{
      id: 'cls-1', message_id: 'msg-3', tag: 'intimation', confidence: 0.95, is_active: true,
    }];
    dbState.extraction_results = [{
      id: 'ext-1', message_id: 'msg-3', is_valid: false, extracted_data: {},
    }];

    const result = await executeRouting('msg-3');

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/extraction invalid/);
  });

  it('skips when confidence is below the tag threshold', async () => {
    dbState.inbox_messages = [{
      id: 'msg-4', status: 'pending_review', company: 'NISLA',
    }];
    dbState.message_classifications = [{
      id: 'cls-2', message_id: 'msg-4', tag: 'intimation', confidence: 0.80, is_active: true,
    }];
    dbState.extraction_results = [{
      id: 'ext-2', message_id: 'msg-4', is_valid: true, extracted_data: {},
    }];

    const result = await executeRouting('msg-4');

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/confidence 0.8 < threshold 0.92/);
  });

  it('routes successfully when all guards pass and links to existing claim', async () => {
    dbState.inbox_messages = [{
      id: 'msg-5', status: 'pending_review', company: 'NISLA', from_address: 'a@b.com',
    }];
    dbState.message_classifications = [{
      id: 'cls-3', message_id: 'msg-5', tag: 'client_followup', confidence: 0.90, is_active: true,
    }];
    dbState.extraction_results = [{
      id: 'ext-3', message_id: 'msg-5', is_valid: true,
      extracted_data: { claim_ref: 'CLM-2026-0001' },
    }];
    dbState.claims = [{
      id: 42, ref_number: 'CLM-2026-0001', lob: 'motor', status: 'open', company: 'NISLA',
    }];

    const result = await executeRouting('msg-5');

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.tag).toBe('client_followup');
    expect(result.claimId).toBe(42);
    expect(result.actionsExecuted).toBe(1); // link_to_claim
    expect(result.results[0].actionType).toBe('link_to_claim');
    expect(result.results[0].status).toBe('success');

    // Verify routing_executions row was written
    expect(dbState.routing_executions_inserted).toHaveLength(1);
    expect(dbState.routing_executions_inserted[0]).toMatchObject({
      message_id: 'msg-5',
      action_type: 'link_to_claim',
      status: 'success',
    });

    // Verify the message was marked auto_routed
    const finalUpdate = dbState.inbox_messages_updates.find(
      (u) => u.updateVals.status === 'auto_routed',
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate.updateVals.claim_id).toBe(42);
  });

  it('records skipped status when link_to_claim has no matching claim', async () => {
    dbState.inbox_messages = [{
      id: 'msg-6', status: 'pending_review', company: 'NISLA', from_address: 'a@b.com',
    }];
    dbState.message_classifications = [{
      id: 'cls-4', message_id: 'msg-6', tag: 'client_followup', confidence: 0.90, is_active: true,
    }];
    dbState.extraction_results = [{
      id: 'ext-4', message_id: 'msg-6', is_valid: true,
      extracted_data: { claim_ref: 'NONEXISTENT-REF' },
    }];
    // No claims seeded — lookup will return null.

    const result = await executeRouting('msg-6');

    expect(result.ok).toBe(true);
    expect(result.results[0].status).toBe('skipped');
    expect(result.results[0].error).toMatch(/no matching claim/);
  });

  it('runs multiple actions and records each in routing_executions', async () => {
    dbState.inbox_messages = [{
      id: 'msg-7', status: 'pending_review', company: 'NISLA', from_address: 'i@x.com',
    }];
    dbState.message_classifications = [{
      id: 'cls-5', message_id: 'msg-7', tag: 'settlement_advice', confidence: 0.95, is_active: true,
    }];
    dbState.extraction_results = [{
      id: 'ext-5', message_id: 'msg-7', is_valid: true,
      extracted_data: {
        claim_ref: 'CLM-2026-0042',
        settled_amount: 75000,
        settlement_date: '2026-04-20',
      },
    }];
    dbState.claims = [{
      id: 99, ref_number: 'CLM-2026-0042', lob: 'motor', status: 'open', company: 'NISLA',
    }];

    const result = await executeRouting('msg-7');

    expect(result.ok).toBe(true);
    expect(result.actionsExecuted).toBe(2); // link + update_settlement
    expect(dbState.routing_executions_inserted).toHaveLength(2);

    const actionTypes = dbState.routing_executions_inserted.map((r) => r.action_type);
    expect(actionTypes).toContain('link_to_claim');
    expect(actionTypes).toContain('update_claim_settlement');
  });

  it('returns error when message does not exist', async () => {
    const result = await executeRouting('nonexistent-id');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/message not found/);
  });

  it('returns error when called with no messageId', async () => {
    const result = await executeRouting(null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/messageId required/);
  });
});
