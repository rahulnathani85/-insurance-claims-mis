// =============================================================================
// lib/folderPath.js
// =============================================================================
// Computes the on-disk path for a claim's working folder. The local file-server
// (scripts/file-server/server.js) auto-creates the directory on first upload
// via multer.diskStorage's mkdirSync({recursive:true}), so this helper just
// produces the path string — no HTTP call required, no eager mkdir.
//
// Convention (matches the legacy /api/claims POST behaviour):
//   D:\2026-27\<company>\<LOB>\<sanitised-ref> - <sanitised-insured>
// Example:
//   D:\2026-27\NISLA\Marine Cargo\4050_26-27_Marine - Chifu Agritech Pvt Ltd
// =============================================================================

// Windows-illegal path characters: < > : " / \ | ? *
const ILLEGAL = /[<>:"/\\|?*]/g;

const INSURED_MAX_LEN = 50;

export function generateFolderPath({ company, lob, refNumber, insuredName } = {}) {
  const safeCo   = String(company    ?? 'NISLA'         ).replace(ILLEGAL, '_');
  const safeLob  = String(lob        ?? 'Miscellaneous' ).replace(ILLEGAL, '_');
  const safeRef  = String(refNumber  ?? ''              ).replace(ILLEGAL, '_');
  const safeName = String(insuredName ?? 'Unknown'      ).replace(ILLEGAL, '_').slice(0, INSURED_MAX_LEN);
  return `D:\\2026-27\\${safeCo}\\${safeLob}\\${safeRef} - ${safeName}`;
}
