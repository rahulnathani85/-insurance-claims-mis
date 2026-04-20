// =============================================================================
// /app/api/lifecycle/_deprecated/route.js
// =============================================================================
// Shim handler returning 410 Gone for the old endpoints. Deploy for 30 days.
//
// Wire this into each old route file (e.g. /app/api/claim-stages/route.js) like:
//
//   export { GET, POST, PUT, DELETE } from '@/app/api/lifecycle/_deprecated/route';
//
// Then delete those folders after the 30-day grace window.
// =============================================================================

const DEPRECATED_ENDPOINTS = [
  '/api/claim-stages',
  '/api/claim-workflow',
  '/api/claim-workflow-history',
  '/api/ew-claim-stages',
];

async function handleDeprecated(request) {
  return Response.json({
    error: 'This endpoint is deprecated as of the Lifecycle Engine cutover.',
    new_endpoint: '/api/lifecycle/*',
    docs: 'See NISLA_Lifecycle_Engine_Specification.docx',
    deprecated_endpoints: DEPRECATED_ENDPOINTS,
  }, { status: 410 });
}

export const GET = handleDeprecated;
export const POST = handleDeprecated;
export const PUT = handleDeprecated;
export const PATCH = handleDeprecated;
export const DELETE = handleDeprecated;
