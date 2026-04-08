import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

// GET - User monitoring data (admin only)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company');
  const userEmail = searchParams.get('user_email');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  try {
    // 1. Get all active users
    let usersQuery = supabase
      .from('app_users')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (company && company !== 'All' && company !== 'Development') {
      usersQuery = usersQuery.eq('company', company);
    }

    const { data: users, error: usersError } = await usersQuery;
    if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 });

    // 2. Get activity counts per user
    const startDate = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = toDate || new Date().toISOString().split('T')[0];

    let activityQuery = supabase
      .from('activity_log')
      .select('user_email, action, entity_type, claim_id, created_at')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59');

    if (company && company !== 'All' && company !== 'Development') {
      activityQuery = activityQuery.eq('company', company);
    }
    if (userEmail) {
      activityQuery = activityQuery.eq('user_email', userEmail);
    }

    const { data: activities, error: actError } = await activityQuery;
    if (actError) return NextResponse.json({ error: actError.message }, { status: 500 });

    // 3. Get messages sent per user
    let msgsQuery = supabase
      .from('claim_messages')
      .select('sender_email, created_at')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59');

    if (company && company !== 'All' && company !== 'Development') {
      msgsQuery = msgsQuery.eq('company', company);
    }

    const { data: messages } = await msgsQuery;

    // 4. Get claim assignments per user
    let assignQuery = supabase
      .from('claim_assignments')
      .select('assigned_to, status, claim_id');

    if (company && company !== 'All' && company !== 'Development') {
      assignQuery = assignQuery.eq('company', company);
    }

    const { data: assignments } = await assignQuery;

    // 5. Aggregate per user
    const userStats = (users || []).map(u => {
      const userActivities = (activities || []).filter(a => a.user_email === u.email);
      const userMessages = (messages || []).filter(m => m.sender_email === u.email);
      const userAssignments = (assignments || []).filter(a => a.assigned_to === u.email);

      const actionCounts = {};
      userActivities.forEach(a => {
        actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
      });

      const uniqueClaims = new Set(userActivities.filter(a => a.claim_id).map(a => a.claim_id));
      const activeDays = new Set(userActivities.map(a => new Date(a.created_at).toDateString()));

      return {
        id: u.id, name: u.name, email: u.email, role: u.role,
        company: u.company, is_active: u.is_active,
        last_login: u.last_login, last_active: u.last_active,
        total_activities: userActivities.length,
        total_messages: userMessages.length,
        total_claims_worked: uniqueClaims.size,
        active_days: activeDays.size,
        action_breakdown: actionCounts,
        assignments_total: userAssignments.length,
        assignments_completed: userAssignments.filter(a => a.status === 'Completed').length,
        assignments_in_progress: userAssignments.filter(a => a.status === 'In Progress' || a.status === 'Assigned').length,
      };
    });

    return NextResponse.json({
      users: userStats,
      period: { from: startDate, to: endDate },
      total_activities: (activities || []).length,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
