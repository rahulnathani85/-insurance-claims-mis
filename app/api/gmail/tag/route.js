import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// POST - Tag an email to a claim (save email reference + optionally download attachments)
export async function POST(request) {
  const body = await request.json();
  const { claim_id, ref_number, message_id, thread_id, subject, sender, recipients, email_date, snippet, has_attachments, tagged_by, company, user_email } = body;

  if (!claim_id || !message_id) {
    return NextResponse.json({ error: 'claim_id and message_id are required' }, { status: 400 });
  }

  // Check if already tagged
  const { data: existing } = await supabase
    .from('claim_emails')
    .select('id')
    .eq('claim_id', claim_id)
    .eq('gmail_message_id', message_id)
    .single();

  if (existing) {
    return NextResponse.json({ error: 'This email is already tagged to this claim' }, { status: 409 });
  }

  // Save the email reference
  const { data, error } = await supabase
    .from('claim_emails')
    .insert([{
      claim_id,
      ref_number: ref_number || '',
      gmail_message_id: message_id,
      gmail_thread_id: thread_id || '',
      subject: subject || '',
      sender: sender || '',
      recipients: recipients || '',
      email_date: email_date ? new Date(email_date).toISOString() : null,
      snippet: snippet || '',
      has_attachments: has_attachments || false,
      tagged_by: tagged_by || '',
      company: company || 'NISLA',
    }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If email has attachments, try to download and save them to the claim folder
  if (has_attachments && user_email) {
    try {
      // Get access token
      const { data: tokenData } = await supabase
        .from('gmail_tokens')
        .select('access_token')
        .eq('user_email', user_email)
        .single();

      if (tokenData?.access_token) {
        // Get full message with attachments
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=full`,
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const msgData = await msgRes.json();

        // Find attachment parts
        const parts = msgData.payload?.parts || [];
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            // Download attachment
            const attRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/attachments/${part.body.attachmentId}`,
              { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
            );
            const attData = await attRes.json();

            if (attData.data) {
              // Decode base64url to buffer
              const buffer = Buffer.from(attData.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
              const safeRef = (ref_number || claim_id).toString().replace(/[^a-zA-Z0-9\-_]/g, '_');
              const storagePath = `claims/${safeRef}/emails/${Date.now()}_${part.filename}`;

              // Upload to Supabase Storage
              await supabaseAdmin.storage
                .from('claim-documents')
                .upload(storagePath, buffer, {
                  contentType: part.mimeType || 'application/octet-stream',
                });

              // Record in claim_documents
              await supabase.from('claim_documents').insert([{
                claim_id,
                ref_number: ref_number || '',
                file_name: part.filename,
                file_type: 'email_attachment',
                file_size: buffer.length,
                storage_path: storagePath,
                mime_type: part.mimeType,
                uploaded_by: tagged_by || '',
                source: 'gmail',
                gmail_message_id: message_id,
                gmail_subject: subject,
                gmail_from: sender,
                gmail_date: email_date ? new Date(email_date).toISOString() : null,
                company: company || 'NISLA',
              }]);
            }
          }
        }
      }
    } catch (attErr) {
      console.error('Failed to download email attachments:', attErr);
      // Don't fail the whole tag operation if attachment download fails
    }
  }

  return NextResponse.json(data, { status: 201 });
}

// GET - Get emails tagged to a claim
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get('claim_id');

  if (!claimId) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('claim_emails')
    .select('*')
    .eq('claim_id', claimId)
    .order('email_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
