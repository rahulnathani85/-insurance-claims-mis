import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import {
  decorateSurveyor,
  sanitiseSurveyorPayload,
  LICENSE_CATEGORIES,
} from '@/lib/surveyors';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('include_inactive') === 'true';

  let query = supabase.from('surveyors').select('*').order('name');
  if (!includeInactive) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const decorated = (data || []).map((row) => decorateSurveyor(row, today));
  return NextResponse.json(decorated);
}

export async function POST(request) {
  const body = await request.json();

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (body.license_category && !LICENSE_CATEGORIES.includes(body.license_category)) {
    return NextResponse.json(
      { error: `license_category must be one of: ${LICENSE_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  const insert = sanitiseSurveyorPayload(body);

  const { data, error } = await supabase
    .from('surveyors')
    .insert([insert])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'License number already exists' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(decorateSurveyor(data), { status: 201 });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Soft delete — preserve history for assignment audit trail.
  const { error } = await supabase
    .from('surveyors')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
