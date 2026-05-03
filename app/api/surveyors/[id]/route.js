import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import {
  decorateSurveyor,
  sanitiseSurveyorPayload,
  LICENSE_CATEGORIES,
} from '@/lib/surveyors';

export async function GET(_request, { params }) {
  const { id } = params;
  const { data, error } = await supabase
    .from('surveyors')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(decorateSurveyor(data));
}

export async function PUT(request, { params }) {
  const { id } = params;
  const body = await request.json();

  if (body.license_category && !LICENSE_CATEGORIES.includes(body.license_category)) {
    return NextResponse.json(
      { error: `license_category must be one of: ${LICENSE_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  const updates = sanitiseSurveyorPayload(body);
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('surveyors')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'License number already exists' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(decorateSurveyor(data));
}

export async function DELETE(_request, { params }) {
  const { id } = params;
  const { error } = await supabase
    .from('surveyors')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
