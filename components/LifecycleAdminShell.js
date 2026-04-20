'use client';
// =============================================================================
// LifecycleAdminShell
// =============================================================================
// Shared chrome for all 11 Lifecycle Admin views + the Live Claim View.
//
// This wraps the standard portal PageLayout and adds the secondary admin nav
// (the "Main / Admin — Templates / Admin — Advanced / Operations" sidebar
// buckets from the mockup) as a horizontal tab strip inside the main-content
// area. That keeps the portal's own chrome consistent and lets us have a
// single source of truth for the 11-view navigation.
//
// Use like:
//
//   <LifecycleAdminShell
//     view="templates"
//     title="Template Library"
//     subtitle="Inheritance tree + cascade resolution"
//     actions={<button className="btn btn-primary">+ New Template</button>}
//     stats={{ templates: 9, items: 23, branching: 6, timerules: 2 }}
//   >
//     {pageContent}
//   </LifecycleAdminShell>
//
// All counts shown on the top-tab strip are optional — pass whatever you have
// and the rest will render blank.
// =============================================================================

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useAuth } from '@/lib/AuthContext';

// All admin views — merged from NISLA_Lifecycle_Admin_UI_v2 (11 views) + the
// older NISLA_Lifecycle_Engine_Mockup (3 extra views: Phases Reference, TAT
// Breaches, DB Schema). Every button, view, and piece of content called for
// in either mockup is reachable from here.
const NAV = [
  { group: 'Main', items: [
    { key: 'dashboard',   label: 'Dashboard',           href: '/admin/lifecycle' },
    { key: 'breaches',    label: 'TAT Breaches',        href: '/admin/lifecycle/breaches',   countKey: 'breaches' },
    { key: 'live',        label: 'Live Claim View',     href: '/admin/lifecycle/live' },
    { key: 'resolver',    label: 'Resolution Debugger', href: '/admin/lifecycle/resolver' },
  ]},
  { group: 'Admin — Templates', items: [
    { key: 'templates',   label: 'Template Library',    href: '/admin/lifecycle/templates',  countKey: 'templates' },
    { key: 'items',       label: 'Item Catalog',        href: '/admin/lifecycle/items',      countKey: 'items' },
  ]},
  { group: 'Admin — Advanced', items: [
    { key: 'branching',   label: 'Branching Rules',     href: '/admin/lifecycle/branching',  countKey: 'branching' },
    { key: 'subtasks',    label: 'Sub-task Editor',     href: '/admin/lifecycle/subtasks' },
    { key: 'timerules',   label: 'Time-Based Rules',    href: '/admin/lifecycle/time-rules', countKey: 'timerules' },
  ]},
  { group: 'Reference', items: [
    { key: 'phases',      label: 'Phases Reference',    href: '/admin/lifecycle/phases' },
    { key: 'schema',      label: 'DB Schema',           href: '/admin/lifecycle/schema' },
  ]},
  { group: 'Operations', items: [
    { key: 'audit',       label: 'History & Audit',     href: '/admin/lifecycle/audit' },
    { key: 'permissions', label: 'Permissions',         href: '/admin/lifecycle/permissions' },
    { key: 'migration',   label: 'Migration Status',    href: '/admin/lifecycle/migration' },
  ]},
];

// Single flattened lookup for breadcrumb titles.
const TITLES = {
  dashboard:   'Dashboard',
  breaches:    'TAT Breaches',
  live:        'Live Claim View',
  resolver:    'Resolution Debugger',
  templates:   'Template Library',
  items:       'Item-Type Catalog',
  branching:   'Branching Rules',
  subtasks:    'Sub-task Editor',
  timerules:   'Time-Based Template Rules',
  phases:      '7 Universal Phases',
  schema:      'Database Schema',
  audit:       'History & Audit Log',
  permissions: 'Role Permissions',
  migration:   'Migration Status',
};

export { TITLES };

export default function LifecycleAdminShell({
  view,
  title,
  subtitle,
  actions = null,
  stats = {},
  children,
  companySelector = true,
  noAdminGuard = false,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  // Gate: the lifecycle engine admin surface is Admin-only. The Live Claim
  // View is reachable by surveyors too (they need it for their own claims);
  // pages that want to allow non-admins set `noAdminGuard`.
  if (!noAdminGuard && !isAdmin) {
    return (
      <PageLayout>
        <div className="main-content">
          <div style={{ maxWidth: 600, margin: '60px auto', padding: 30, textAlign: 'center',
                        background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
            <h2 style={{ margin: 0, color: '#92400e' }}>Admin access required</h2>
            <p style={{ color: '#78350f', fontSize: 13, marginTop: 10 }}>
              The Lifecycle Engine admin surface is restricted to Admin accounts.
              Contact your portal administrator for access.
            </p>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div style={{ padding: '16px 20px', maxWidth: 1500, margin: '0 auto' }}>
        {/* Topbar — breadcrumb + title + right-side actions */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '12px 0', borderBottom: '1px solid #e5e7eb', marginBottom: 14,
        }}>
          <div>
            <div style={{ fontSize: 11.5, color: '#6b7280' }}>
              <span style={{ color: '#1e3a5f', cursor: 'pointer' }}
                    onClick={() => router.push('/admin/lifecycle')}>Lifecycle Engine</span>
              {' / '}
              <span>{TITLES[view] || title || 'Lifecycle'}</span>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '2px 0 0' }}>
              {title || TITLES[view] || 'Lifecycle Engine'}
            </h1>
            {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{subtitle}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {actions}
          </div>
        </div>

        {/* Secondary nav — the 11 views, grouped the way the mockup groups them */}
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '10px 12px', marginBottom: 16,
          display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {NAV.map(g => (
            <div key={g.group} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: 0.8, marginRight: 2,
              }}>
                {g.group}
              </span>
              {g.items.map(item => {
                const active = view === item.key || pathname === item.href;
                const count = item.countKey ? stats[item.countKey] : undefined;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    style={{
                      padding: '5px 11px', borderRadius: 6, fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      background: active ? '#4B0082' : '#fff',
                      color: active ? '#fff' : '#374151',
                      border: active ? 'none' : '1px solid #d1d5db',
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    {item.label}
                    {count !== undefined && count !== null && (
                      <span style={{
                        background: active ? 'rgba(255,255,255,0.25)' : '#e5e7eb',
                        color: active ? '#fff' : '#374151',
                        padding: '1px 7px', borderRadius: 9, fontSize: 10,
                      }}>{count}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {children}
      </div>
    </PageLayout>
  );
}

// --- Tiny shared primitives used across the admin pages -------------------
// (Exported so each page doesn't have to redefine them.)

export function Card({ title, subtitle, actions, children, style }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: '16px 20px', marginBottom: 14, ...style,
    }}>
      {(title || actions) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #e5e7eb',
        }}>
          <div>
            {title && <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>{title}</h3>}
            {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  const toneColor = tone === 'success' ? '#059669' : tone === 'danger' ? '#b91c1c' : tone === 'warn' ? '#b45309' : '#111827';
  return (
    <div style={{
      background: '#fff', borderRadius: 8, padding: '14px 16px',
      border: '1px solid #e5e7eb',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280',
                    letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: toneColor, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

export function Note({ tone = 'info', children }) {
  const palette = {
    info:    { bg: '#dbeafe', br: '#2563eb', tx: '#1e40af' },
    warn:    { bg: '#fef3c7', br: '#f59e0b', tx: '#78350f' },
    success: { bg: '#d1fae5', br: '#10b981', tx: '#065f46' },
    danger:  { bg: '#fee2e2', br: '#ef4444', tx: '#991b1b' },
  }[tone];
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 6, fontSize: 12, marginBottom: 14,
      background: palette.bg, borderLeft: `3px solid ${palette.br}`, color: palette.tx,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

export function Badge({ tone, children }) {
  const palette = {
    active:       { bg: '#fef3c7', tx: '#92400e' },
    complete:     { bg: '#d1fae5', tx: '#065f46' },
    pending:      { bg: '#e5e7eb', tx: '#374151' },
    breached:     { bg: '#fee2e2', tx: '#991b1b' },
    skipped:      { bg: '#f3f4f6', tx: '#9ca3af' },
    autocomplete: { bg: '#bbf7d0', tx: '#14532d' },
    lob:          { bg: '#ede9fe', tx: '#5b21b6' },
    portfolio:    { bg: '#dbeafe', tx: '#1e40af' },
    client:       { bg: '#fce7f3', tx: '#9d174d' },
    override:     { bg: '#fef3c7', tx: '#78350f' },
    full:         { bg: '#dbeafe', tx: '#1e40af' },
    neutral:      { bg: '#f3f4f6', tx: '#374151' },
  }[tone] || { bg: '#f3f4f6', tx: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, background: palette.bg, color: palette.tx,
      marginRight: 4,
    }}>{children}</span>
  );
}

export function Tag({ tone, children }) {
  const palette = {
    'firm-pause':    { bg: '#f3e8ff', tx: '#6b21a8' },
    'firm-run':      { bg: '#fecaca', tx: '#991b1b' },
    'insurer-pause': { bg: '#e0e7ff', tx: '#3730a3' },
    'insurer-run':   { bg: '#fed7aa', tx: '#9a3412' },
  }[tone] || { bg: '#f3f4f6', tx: '#374151' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: palette.bg, color: palette.tx,
      marginRight: 4,
    }}>{children}</span>
  );
}

export function Modal({ open, title, onClose, children, footer, large }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, width: '100%',
          maxWidth: large ? 900 : 720, maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          position: 'sticky', top: 0, background: '#fff', zIndex: 2,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer',
            color: '#6b7280', padding: '4px 8px',
          }}>×</button>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid #e5e7eb',
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            position: 'sticky', bottom: 0, background: '#fff',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function FormGrid({ children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '180px 1fr', gap: '10px 14px',
      alignItems: 'start',
    }}>
      {children}
    </div>
  );
}

export function FG({ label, children, hint }) {
  return (
    <>
      <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 600, paddingTop: 8 }}>{label}</label>
      <div>
        {children}
        {hint && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{hint}</div>}
      </div>
    </>
  );
}

export function Btn({ variant = 'secondary', size, children, ...rest }) {
  const bg = {
    primary:   '#4B0082',
    secondary: '#fff',
    danger:    '#fff',
    ghost:     'transparent',
  }[variant];
  const color = {
    primary:   '#fff',
    secondary: '#374151',
    danger:    '#b91c1c',
    ghost:     '#4b5563',
  }[variant];
  const border = variant === 'secondary' ? '1px solid #d1d5db'
               : variant === 'danger'    ? '1px solid #fca5a5'
               : 'none';
  const pad = size === 'xs' ? '2px 8px' : size === 'sm' ? '4px 10px' : '7px 13px';
  const fs  = size === 'xs' ? 11 : size === 'sm' ? 12 : 13;
  return (
    <button
      {...rest}
      style={{
        padding: pad, fontSize: fs, fontWeight: 600, background: bg, color,
        border, borderRadius: 6, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        ...(rest.style || {}),
      }}
    >
      {children}
    </button>
  );
}

// Phase stepper tile state → colour
export function PhaseStep({ num, name, state, tone }) {
  const palette = {
    complete:     { bg: '#10b981', tx: '#fff' },
    autocomplete: { bg: '#6ee7b7', tx: '#064e3b' },
    active:       { bg: '#f59e0b', tx: '#fff' },
    breach:       { bg: '#ef4444', tx: '#fff' },
    pending:      { bg: '#f3f4f6', tx: '#9ca3af' },
    skipped:      { bg: '#9ca3af', tx: '#fff' },
  }[tone] || { bg: '#f3f4f6', tx: '#9ca3af' };
  return (
    <div style={{
      flex: 1, minWidth: 130, padding: '12px 14px',
      borderRight: '1px solid rgba(255,255,255,0.3)',
      background: palette.bg, color: palette.tx, fontSize: 11,
    }}>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{num}</div>
      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>{name}</div>
      {state && <div style={{ fontSize: 10, opacity: 0.85, marginTop: 3,
                              textTransform: 'uppercase', letterSpacing: 0.5 }}>{state}</div>}
    </div>
  );
}

export function PhaseStepper({ children }) {
  return (
    <div style={{
      display: 'flex', overflowX: 'auto', borderRadius: 8,
      background: '#fff', border: '1px solid #e5e7eb', marginBottom: 12,
    }}>
      {children}
    </div>
  );
}
