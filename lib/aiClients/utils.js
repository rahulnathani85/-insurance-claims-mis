// ============================================================
// lib/aiClients/utils.js
// ------------------------------------------------------------
// Shared helpers used by the LLM and OCR clients.
// ============================================================

// dynamicImport wraps `await import(...)` so individual provider
// files can require optional SDKs without breaking the build.
// If the package isn't installed, the import throws and the caller
// converts that into a friendly "install X" error.
//
// We use a tiny indirection so static analysers (and Webpack/Turbopack)
// don't try to resolve the module at build time when the literal
// string is computed.
export async function dynamicImport(moduleName) {
  // eslint-disable-next-line no-new-func
  const importer = new Function('m', 'return import(m)');
  return importer(moduleName);
}

// Clamp a value into [min, max].
export function clamp(n, min, max) {
  if (typeof n !== 'number' || Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
