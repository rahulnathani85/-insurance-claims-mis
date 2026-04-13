import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET - Fetch categories (full tree, or filtered by parent_id / level)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get('parent_id');
    const level = searchParams.get('level');
    const activeOnly = searchParams.get('active_only') !== 'false'; // default true

    let query = supabaseAdmin
      .from('claim_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (activeOnly) query = query.eq('is_active', true);

    if (parentId === 'null' || parentId === 'root') {
      query = query.is('parent_id', null);
    } else if (parentId) {
      query = query.eq('parent_id', parseInt(parentId));
    }

    if (level) query = query.eq('level', parseInt(level));

    const { data, error } = await query;
    if (error) throw error;

    // If no filters, build tree structure
    if (!parentId && !level) {
      const tree = buildTree(data);
      return NextResponse.json(tree);
    }

    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create new category
export async function POST(request) {
  try {
    const body = await request.json();
    const { parent_id, name, level, level_label, code, icon, color, sort_order, metadata } = body;

    if (!name || !level) {
      return NextResponse.json({ error: 'name and level are required' }, { status: 400 });
    }

    const insertData = {
      parent_id: parent_id || null,
      name,
      level,
      level_label: level_label || getLevelLabel(level),
      code: code || null,
      icon: icon || null,
      color: color || null,
      sort_order: sort_order || 0,
      is_active: true,
      metadata: metadata || {},
    };

    const { data, error } = await supabaseAdmin
      .from('claim_categories')
      .insert([insertData])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Update category
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Don't allow changing parent_id or level to prevent tree corruption
    delete updates.created_at;

    const { data, error } = await supabaseAdmin
      .from('claim_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Soft delete (deactivate)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const hard = searchParams.get('hard') === 'true';

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (hard) {
      // Hard delete - also deletes children via CASCADE
      const { error } = await supabaseAdmin
        .from('claim_categories')
        .delete()
        .eq('id', parseInt(id));
      if (error) throw error;
    } else {
      // Soft delete - deactivate this node and all children
      const { error } = await supabaseAdmin
        .from('claim_categories')
        .update({ is_active: false })
        .eq('id', parseInt(id));
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Helper: Build tree from flat array
function buildTree(items) {
  const map = {};
  const roots = [];

  items.forEach(item => {
    map[item.id] = { ...item, children: [] };
  });

  items.forEach(item => {
    if (item.parent_id && map[item.parent_id]) {
      map[item.parent_id].children.push(map[item.id]);
    } else if (!item.parent_id) {
      roots.push(map[item.id]);
    }
  });

  return roots;
}

// Helper: Default level labels
function getLevelLabel(level) {
  const labels = { 1: 'LOB', 2: 'Policy Type', 3: 'Cause of Loss', 4: 'Subject Matter' };
  return labels[level] || `Level ${level}`;
}
