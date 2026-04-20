export const COMPANIES = [
  { value: 'NISLA', label: 'Nathani Insurance Surveyors & Loss Assessors (NISLA)' },
  { value: 'Acuere', label: 'Acuere Surveyors' },
  { value: 'All', label: 'All Firms (Combined View)' },
  { value: 'Development', label: 'Development Mode' }
];

export const LOB_LIST = [
  'Fire', 'Engineering', 'Marine Cargo', 'Extended Warranty', 'Business Interruption',
  'Miscellaneous', 'Banking', 'Liability', 'Marine Hull', 'Cat Event'
];

export const STATUS_CHOICES = ['Open', 'In Process', 'Submitted'];

export const MARINE_CLIENTS = [
  'Tata Motors', 'Grasim', 'Nerolac', 'Tiles', 'Aditya Birla Fashion', 'Others Domestic', 'Others Import'
];

export const MARINE_CLIENT_FORMATS = {
  'Tata Motors': 'TMT', 'Grasim': 'GRASIM', 'Nerolac': 'NEROLAC', 'Tiles': 'TILES',
  'Aditya Birla Fashion': 'ABF', 'Others Domestic': '4001', 'Others Import': '4001'
};

export const LOB_COLORS = {
  'Fire': '#dc2626',
  'Engineering': '#2563eb',
  'Marine Cargo': '#0891b2',
  'Extended Warranty': '#7c3aed',
  'Business Interruption': '#ea580c',
  'Miscellaneous': '#65a30d',
  'Banking': '#0284c7',
  'Liability': '#be185d',
  'Marine Hull': '#0d9488',
  'Cat Event': '#9333ea'
};

export const LOB_ICONS = {
  'Fire': '🔥', 'Engineering': '⚙️', 'Marine Cargo': '⚓',
  'Extended Warranty': '✓', 'Business Interruption': '📊',
  'Miscellaneous': '📦', 'Banking': '🏦', 'Liability': '⚖️',
  'Marine Hull': '🚢', 'Cat Event': '⛈️'
};

// File Server URL — runs on the Windows VPS.
// URL is safe to ship to the browser (used for public endpoints like
// /browse, /api/download, and for building deep-links to the file server).
export const FILE_SERVER_URL = process.env.NEXT_PUBLIC_FILE_SERVER_URL || 'http://localhost:4000';

// NOTE: FILE_SERVER_KEY has been intentionally REMOVED from client-side code.
// The API key is server-only (process.env.FILE_SERVER_KEY, no NEXT_PUBLIC_
// prefix). Authenticated operations now go through server-side proxy routes
// such as /api/files/upload, which attach the key on the server before
// forwarding to the VPS. Never re-export the key here — doing so would ship
// it in the browser bundle.
