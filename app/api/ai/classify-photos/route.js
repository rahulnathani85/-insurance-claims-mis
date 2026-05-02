// =============================================================================
// /api/ai/classify-photos
// =============================================================================
// Slice 9 — AI vision classification of site_visit_photos.
//
// Downloads each photo from the file-server, base64-encodes it,
// batches up to 8 images per Claude vision call, parses the JSON
// response, and writes the per-photo classification (category, tags,
// observations, suggested_annexure, confidence, flags) back into
// site_visit_photos.
//
// Two modes:
//
//   1. Whole-claim (typical use)
//      POST { claim_id }
//      Classifies every photo for that claim with classification_status =
//      'unclassified'. (Photos already classified are left alone — pass
//      reclassify=true to re-run them.)
//
//   2. Specific photos
//      POST { photo_ids: [<id>, ...] }
//      Classifies the named photos regardless of current status.
//
// Optional body:
//   reclassify   bool   include already-classified photos in mode 1
//   batch_size   int    override default of 8 (range 1..8)
//
// Resp:
//   {
//     ok: true,
//     classified: <count>,
//     failed:     <count>,
//     batches:    <count of vision calls>,
//     results:    [{ photo_id, status, category, flags, error }],
//     provider:   'claude'   (Gemini Flash supports vision but
//                              the JSON-array contract is more reliable
//                              with Claude in our testing.)
//   }
//
// Note on batch size: Claude vision accepts up to 100 images per call
// but JSON contract reliability degrades past ~10. We default to 8.
// =============================================================================

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { FILE_SERVER_URL, buildHeaders } from '@/lib/apiGateway';
import {
  buildPhotoClassifyPrompt,
  parsePhotoClassifyJson,
} from '@/lib/fsr';
import { captureError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;  // vision calls can take 30-60s for batches of 8

const DEFAULT_BATCH_SIZE = 8;
const MAX_BATCH_SIZE = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;  // 4 MB per image — Claude's effective limit

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const claimId = body?.claim_id;
  const photoIds = Array.isArray(body?.photo_ids) ? body.photo_ids : null;
  const reclassify = !!body?.reclassify;
  const batchSize = clampBatch(body?.batch_size);

  if (!claimId && !photoIds) {
    return NextResponse.json({ error: 'claim_id or photo_ids required' }, { status: 400 });
  }

  // ---- Load the photos to classify + claim LOB ----
  let photos = [];
  let claim = null;

  try {
    if (photoIds && photoIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('site_visit_photos')
        .select('id, claim_id, file_name, file_url, mime_type, classification_status')
        .in('id', photoIds);
      if (error) throw error;
      photos = data || [];
      // Resolve claim from the first photo (assume all from same claim).
      if (photos.length > 0) {
        const { data: c } = await supabaseAdmin
          .from('claims').select('id, lob, company').eq('id', photos[0].claim_id).maybeSingle();
        claim = c || null;
      }
    } else {
      const { data: c } = await supabaseAdmin
        .from('claims').select('id, lob, company').eq('id', claimId).single();
      if (!c) return NextResponse.json({ error: 'claim not found' }, { status: 404 });
      claim = c;

      let q = supabaseAdmin
        .from('site_visit_photos')
        .select('id, claim_id, file_name, file_url, mime_type, classification_status')
        .eq('claim_id', claimId);
      if (!reclassify) q = q.eq('classification_status', 'unclassified');
      const { data, error } = await q;
      if (error) throw error;
      photos = data || [];
    }
  } catch (e) {
    captureError(e, { area: 'classify-photos-load', claim_id: claimId });
    return NextResponse.json({ error: 'load failed: ' + e.message }, { status: 500 });
  }

  if (!claim) {
    return NextResponse.json({ error: 'claim could not be resolved' }, { status: 404 });
  }
  if (photos.length === 0) {
    return NextResponse.json({
      ok: true, classified: 0, failed: 0, batches: 0, results: [],
      message: 'No photos to classify',
    });
  }

  // ---- Anthropic SDK lazy-loaded (vision is Claude-only here) ----
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({
      error: 'ANTHROPIC_API_KEY not configured. Vision classification requires Claude (Gemini fallback not implemented for vision).',
    }, { status: 500 });
  }

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch (e) {
    return NextResponse.json({ error: 'Anthropic SDK unavailable: ' + e.message }, { status: 500 });
  }
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // ---- Process in batches ----
  const results = [];
  let classified = 0;
  let failed = 0;
  let batches = 0;

  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize);

    // Download + base64-encode each photo. Failures within a batch
    // don't abort the rest — they're flagged individually.
    const downloads = await Promise.all(batch.map(downloadAsBase64));
    const okDownloads = downloads.filter((d) => d.ok);
    const failedDownloads = downloads.filter((d) => !d.ok);

    // Mark download failures
    for (const d of failedDownloads) {
      await markFailed(d.photo.id, d.error);
      results.push({
        photo_id: d.photo.id,
        file_name: d.photo.file_name,
        status: 'classification_failed',
        error: d.error,
      });
      failed++;
    }
    if (okDownloads.length === 0) continue;

    batches++;

    // Build the prompt + image content blocks
    const prompt = buildPhotoClassifyPrompt({ lob: claim.lob, batchSize: okDownloads.length });
    const userContent = [
      { type: 'text', text: `Classify these ${okDownloads.length} photo(s) in order. Return a JSON array of length ${okDownloads.length}.` },
      ...okDownloads.map((d) => ({
        type: 'image',
        source: { type: 'base64', media_type: d.mediaType, data: d.base64 },
      })),
    ];

    let aiResponse;
    try {
      aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        system: prompt.system,
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (e) {
      captureError(e, { area: 'classify-photos-call', claim_id: claim.id, batch: i });
      // Mark every photo in this batch as failed; continue with the next batch.
      for (const d of okDownloads) {
        await markFailed(d.photo.id, 'AI call failed: ' + e.message);
        results.push({
          photo_id: d.photo.id,
          file_name: d.photo.file_name,
          status: 'classification_failed',
          error: 'AI call failed',
        });
        failed++;
      }
      continue;
    }

    const text = aiResponse?.content?.find?.((c) => c.type === 'text')?.text || '';
    const parsed = parsePhotoClassifyJson(text, okDownloads.length);

    // Persist each classification
    for (let j = 0; j < okDownloads.length; j++) {
      const d = okDownloads[j];
      const c = parsed[j];
      try {
        const { error } = await supabaseAdmin
          .from('site_visit_photos')
          .update({
            classification_status: 'classified',
            category: c.category,
            tags: c.tags,
            ai_observations: c.observations,
            suggested_annexure: c.suggestedAnnexure,
            ai_confidence: c.confidence,
            flags: c.flags,
            classified_at: new Date().toISOString(),
            classified_by: 'ai:claude:sonnet-4',
          })
          .eq('id', d.photo.id);
        if (error) throw error;
        classified++;
        results.push({
          photo_id: d.photo.id,
          file_name: d.photo.file_name,
          status: 'classified',
          category: c.category,
          flags: c.flags,
        });
      } catch (e) {
        captureError(e, { area: 'classify-photos-persist', photo_id: d.photo.id });
        await markFailed(d.photo.id, 'persist failed: ' + e.message);
        results.push({
          photo_id: d.photo.id,
          file_name: d.photo.file_name,
          status: 'classification_failed',
          error: 'persist failed',
        });
        failed++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    classified,
    failed,
    batches,
    results,
    provider: 'claude',
  });
}

// -----------------------------------------------------------------------------
// downloadAsBase64 — pull a site_visit_photo via the file-server, base64-encode
// it. Returns { ok, photo, base64?, mediaType?, error? }.
//
// file_url stored format: '/api/file-proxy?path=<encoded-absolute-path>'.
// We strip the path from that URL and call the file-server's
// /api/download?path=... directly (server-side, with the gateway key).
// -----------------------------------------------------------------------------
async function downloadAsBase64(photo) {
  try {
    if (!photo.file_url) {
      return { ok: false, photo, error: 'photo has no file_url' };
    }
    const m = photo.file_url.match(/[?&]path=([^&]+)/);
    if (!m) return { ok: false, photo, error: 'cannot extract path from file_url' };
    const path = decodeURIComponent(m[1]);

    const res = await fetch(`${FILE_SERVER_URL}/api/download?path=${encodeURIComponent(path)}`, {
      headers: buildHeaders(),
    });
    if (!res.ok) {
      return { ok: false, photo, error: `file-server ${res.status}` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      return { ok: false, photo, error: 'empty file' };
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return { ok: false, photo, error: `file ${(buffer.length / 1024 / 1024).toFixed(1)} MB exceeds Claude vision 4 MB limit` };
    }
    const base64 = buffer.toString('base64');
    const mediaType = mimeFromName(photo.file_name) || photo.mime_type || 'image/jpeg';
    return { ok: true, photo, base64, mediaType };
  } catch (e) {
    return { ok: false, photo, error: e.message };
  }
}

function mimeFromName(name) {
  if (typeof name !== 'string') return null;
  const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return null;
  return ext === '.png'  ? 'image/png'
       : ext === '.webp' ? 'image/webp'
       : ext === '.gif'  ? 'image/gif'
       : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
       : null;
}

async function markFailed(photoId, errorMsg) {
  try {
    await supabaseAdmin
      .from('site_visit_photos')
      .update({
        classification_status: 'classification_failed',
        ai_observations: errorMsg ? `[classify failed] ${errorMsg.slice(0, 250)}` : null,
        classified_at: new Date().toISOString(),
        classified_by: 'system:classify-photos',
      })
      .eq('id', photoId);
  } catch {
    // already in error path; swallow
  }
}

function clampBatch(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(n, MAX_BATCH_SIZE);
}
