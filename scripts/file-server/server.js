/**
 * Insurance Claims MIS - File Server
 *
 * Runs on the Windows cloud server alongside the folder-listener.
 * Provides:
 *   - Browse claim/policy folders via web UI
 *   - Upload files directly to claim folders from the portal
 *   - Download/view files from claim folders
 *   - Folder protection (no delete, no rename)
 *
 * Setup:
 *   1. npm install
 *   2. Edit CONFIG below with your server's public IP/domain
 *   3. node server.js
 *   4. (Optional) node install-service.js  — to run as Windows service
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ========== CONFIGURATION ==========
const CONFIG = {
  PORT: 4000,
  BASE_PATH: 'D:\\2026-27',
  // IMPORTANT: Set this to your server's public IP or domain
  // Example: 'http://your-server-ip:4000' or 'https://files.yourdomain.com'
  SERVER_URL: process.env.FILE_SERVER_URL || 'http://localhost:4000',
  // Secret key to prevent unauthorized uploads (change this!)
  API_KEY: process.env.FILE_SERVER_KEY || 'nisla-file-server-2026',
  // Max file size: 50MB
  MAX_FILE_SIZE: 50 * 1024 * 1024,
};

const app = express();

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: [
    'https://insurance-claims-mis-1kl7.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
}));
app.use(express.json());

// API Key verification middleware for uploads
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== CONFIG.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }
  next();
}

// Security: prevent path traversal attacks
function safePath(requestedPath) {
  const resolved = path.resolve(CONFIG.BASE_PATH, requestedPath || '');
  if (!resolved.startsWith(CONFIG.BASE_PATH)) {
    return null; // Path traversal attempt
  }
  return resolved;
}

// ========== MULTER SETUP (File Upload) ==========
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const folderPath = req.body.folder_path || req.query.folder_path;
    if (!folderPath) {
      return cb(new Error('folder_path is required'));
    }

    // Validate the folder path is within BASE_PATH
    const fullPath = safePath(folderPath);
    if (!fullPath) {
      return cb(new Error('Invalid folder path'));
    }

    // Create folder if it doesn't exist
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    cb(null, fullPath);
  },
  filename: function (req, file, cb) {
    // Keep original filename, but sanitize it
    const safeName = file.originalname.replace(/[<>:"/\\|?*]/g, '_');

    // If file already exists, add timestamp to avoid overwrite
    const fullPath = req.body.folder_path || req.query.folder_path;
    const resolvedPath = safePath(fullPath);
    const filePath = path.join(resolvedPath, safeName);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      const timestamp = Date.now();
      cb(null, `${base}_${timestamp}${ext}`);
    } else {
      cb(null, safeName);
    }
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    // Block executable files
    const blocked = ['.exe', '.bat', '.cmd', '.com', '.vbs', '.js', '.ps1', '.sh'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) {
      return cb(new Error(`File type ${ext} is not allowed`));
    }
    cb(null, true);
  }
});

// ========== ROUTES ==========

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Insurance Claims MIS File Server',
    basePath: CONFIG.BASE_PATH,
    time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  });
});

// Browse folder contents
app.get('/api/browse', (req, res) => {
  const folderPath = req.query.path || '';
  const fullPath = safePath(folderPath);

  if (!fullPath) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  const stat = fs.statSync(fullPath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory' });
  }

  try {
    const items = fs.readdirSync(fullPath).map(name => {
      const itemPath = path.join(fullPath, name);
      try {
        const itemStat = fs.statSync(itemPath);
        return {
          name: name,
          type: itemStat.isDirectory() ? 'folder' : 'file',
          size: itemStat.isFile() ? itemStat.size : null,
          sizeFormatted: itemStat.isFile() ? formatSize(itemStat.size) : null,
          modified: itemStat.mtime.toISOString(),
          modifiedFormatted: itemStat.mtime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          extension: itemStat.isFile() ? path.extname(name).toLowerCase() : null,
          downloadUrl: itemStat.isFile()
            ? `/api/download?path=${encodeURIComponent(path.relative(CONFIG.BASE_PATH, itemPath))}`
            : null
        };
      } catch (e) {
        return { name, type: 'unknown', error: e.message };
      }
    });

    // Sort: folders first, then files
    items.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

    // Build breadcrumb
    const relativePath = path.relative(CONFIG.BASE_PATH, fullPath);
    const parts = relativePath ? relativePath.split(path.sep) : [];
    const breadcrumb = [{ name: 'D:\\2026-27', path: '' }];
    let cumulativePath = '';
    for (const part of parts) {
      cumulativePath = cumulativePath ? `${cumulativePath}\\${part}` : part;
      breadcrumb.push({ name: part, path: cumulativePath });
    }

    res.json({
      path: relativePath || '',
      fullPath: fullPath,
      breadcrumb: breadcrumb,
      items: items,
      totalFiles: items.filter(i => i.type === 'file').length,
      totalFolders: items.filter(i => i.type === 'folder').length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download/view a file
app.get('/api/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const fullPath = safePath(filePath);
  if (!fullPath) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Set content disposition based on query param
  if (req.query.view === 'true') {
    // Inline viewing for images/PDFs
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
    };
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath)}"`);
      return fs.createReadStream(fullPath).pipe(res);
    }
  }

  // Default: download
  res.download(fullPath);
});

// Upload files to a claim/policy folder
app.post('/api/upload', verifyApiKey, upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const uploaded = req.files.map(file => ({
    name: file.filename,
    originalName: file.originalname,
    size: file.size,
    sizeFormatted: formatSize(file.size),
    path: file.path,
    downloadUrl: `/api/download?path=${encodeURIComponent(
      path.relative(CONFIG.BASE_PATH, file.path)
    )}`
  }));

  log(`Uploaded ${uploaded.length} file(s) to ${req.body.folder_path || req.query.folder_path}`);

  res.json({
    success: true,
    message: `${uploaded.length} file(s) uploaded successfully`,
    files: uploaded
  });
});

// Get folder info (for portal to check if folder exists)
app.get('/api/folder-info', (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) {
    return res.status(400).json({ error: 'path is required' });
  }

  const fullPath = safePath(folderPath);
  if (!fullPath) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.json({ exists: false, path: folderPath });
  }

  const items = fs.readdirSync(fullPath);
  const files = items.filter(i => {
    try { return fs.statSync(path.join(fullPath, i)).isFile(); } catch { return false; }
  });
  const folders = items.filter(i => {
    try { return fs.statSync(path.join(fullPath, i)).isDirectory(); } catch { return false; }
  });

  res.json({
    exists: true,
    path: folderPath,
    fullPath: fullPath,
    fileCount: files.length,
    folderCount: folders.length,
    browseUrl: `/browse?path=${encodeURIComponent(path.relative(CONFIG.BASE_PATH, fullPath))}`
  });
});

// ========== DATABASE BACKUP ==========
const SUPABASE_URL = 'https://ffljqrcavjkfpkvvsvza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmbGpxcmNhdmprZnBrdnZzdnphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzA0NTUsImV4cCI6MjA5MDUwNjQ1NX0.2L0PSlrdum5hFkB18os1yaw3pMaOcXVCeHBADK3Hn8o';

// Tables to backup
const BACKUP_TABLES = [
  'claims', 'policies', 'insurers', 'insurer_offices',
  'ref_counters', 'marine_counters', 'bill_counters',
  'survey_fee_bills', 'gipsa_fee_schedule'
];

// Fetch data from Supabase REST API
function fetchSupabaseTable(tableName) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${tableName}?select=*&order=created_at.desc`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

// Backup endpoint - exports all tables as JSON to D:\2026-27\Backups\
app.post('/api/backup', verifyApiKey, async (req, res) => {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // 2026-04-01
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // 12-30-00
    const backupFolderName = `Backup_${dateStr}_${timeStr}`;
    const backupPath = path.join(CONFIG.BASE_PATH, 'Backups', backupFolderName);

    // Create backup folder
    fs.mkdirSync(backupPath, { recursive: true });
    log(`Starting database backup to ${backupPath}`);

    const results = {};
    let totalRecords = 0;

    // Fetch and save each table
    for (const table of BACKUP_TABLES) {
      try {
        const data = await fetchSupabaseTable(table);
        const count = Array.isArray(data) ? data.length : 0;
        totalRecords += count;

        // Save as JSON
        const filePath = path.join(backupPath, `${table}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

        // Also save as CSV for easy viewing in Excel
        if (Array.isArray(data) && data.length > 0) {
          const csvPath = path.join(backupPath, `${table}.csv`);
          const headers = Object.keys(data[0]);
          const csvContent = [
            '\uFEFF' + headers.join(','), // BOM for Excel
            ...data.map(row =>
              headers.map(h => {
                const val = row[h];
                if (val === null || val === undefined) return '';
                const str = String(val).replace(/"/g, '""');
                return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
              }).join(',')
            )
          ].join('\n');
          fs.writeFileSync(csvPath, csvContent, 'utf8');
        }

        results[table] = { records: count, status: 'success' };
        log(`  Backed up ${table}: ${count} records`);
      } catch (err) {
        results[table] = { records: 0, status: 'error', error: err.message };
        log(`  Error backing up ${table}: ${err.message}`);
      }
    }

    // Save backup summary
    const summary = {
      backupDate: now.toISOString(),
      backupDateFormatted: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      backupFolder: backupPath,
      tables: results,
      totalRecords: totalRecords,
      totalTables: BACKUP_TABLES.length
    };
    fs.writeFileSync(
      path.join(backupPath, '_backup_summary.json'),
      JSON.stringify(summary, null, 2), 'utf8'
    );

    log(`Backup complete: ${totalRecords} records from ${BACKUP_TABLES.length} tables`);

    res.json({
      success: true,
      message: `Backup completed successfully`,
      backupFolder: backupPath,
      backupName: backupFolderName,
      totalRecords,
      totalTables: BACKUP_TABLES.length,
      tables: results,
      browseUrl: `/browse?path=${encodeURIComponent(path.relative(CONFIG.BASE_PATH, backupPath))}`
    });
  } catch (err) {
    log(`Backup failed: ${err.message}`);
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// List existing backups
app.get('/api/backups', (req, res) => {
  const backupsPath = path.join(CONFIG.BASE_PATH, 'Backups');
  if (!fs.existsSync(backupsPath)) {
    return res.json({ backups: [] });
  }

  try {
    const items = fs.readdirSync(backupsPath)
      .filter(name => name.startsWith('Backup_'))
      .map(name => {
        const fullPath = path.join(backupsPath, name);
        const stat = fs.statSync(fullPath);
        let summary = null;
        const summaryPath = path.join(fullPath, '_backup_summary.json');
        if (fs.existsSync(summaryPath)) {
          try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
        }
        const files = fs.readdirSync(fullPath);
        return {
          name,
          date: stat.mtime.toISOString(),
          dateFormatted: stat.mtime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          totalRecords: summary?.totalRecords || 0,
          totalTables: summary?.totalTables || 0,
          fileCount: files.length,
          browseUrl: `/browse?path=${encodeURIComponent(path.join('Backups', name))}`
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ backups: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== WEB UI - Folder Browser ==========
app.get('/browse', (req, res) => {
  const folderPath = req.query.path || '';
  res.send(getBrowserHTML(folderPath));
});

// Root redirect to browse
app.get('/', (req, res) => {
  res.redirect('/browse');
});

// ========== BLOCKED OPERATIONS (Folder Protection) ==========
// No delete endpoint
// No rename endpoint
// No move endpoint
// Folders once created CANNOT be removed or renamed through this server

// ========== HELPERS ==========
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function log(message) {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`[${timestamp}] ${message}`);
}

function getBrowserHTML(currentPath) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Insurance Claims MIS - File Browser</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #1a237e; color: white; padding: 15px 24px; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 18px; font-weight: 500; }
    .header .logo { font-size: 24px; }
    .breadcrumb { background: #fff; padding: 12px 24px; border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .breadcrumb a { color: #1a237e; text-decoration: none; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
    .breadcrumb a:hover { background: #e8eaf6; }
    .breadcrumb .sep { color: #999; font-size: 12px; }
    .toolbar { background: #fff; padding: 12px 24px; border-bottom: 1px solid #ddd; display: flex; gap: 12px; align-items: center; }
    .toolbar .info { font-size: 13px; color: #666; }
    .upload-btn { background: #1a237e; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .upload-btn:hover { background: #283593; }
    .content { padding: 16px 24px; }
    .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .file-item { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; cursor: pointer; transition: all 0.15s; text-align: center; }
    .file-item:hover { border-color: #1a237e; box-shadow: 0 2px 8px rgba(26,35,126,0.1); transform: translateY(-1px); }
    .file-item .icon { font-size: 40px; margin-bottom: 8px; }
    .file-item .name { font-size: 13px; font-weight: 500; word-break: break-all; margin-bottom: 4px; }
    .file-item .meta { font-size: 11px; color: #999; }
    .empty { text-align: center; padding: 60px 20px; color: #999; }
    .empty .icon { font-size: 48px; margin-bottom: 12px; }
    .upload-modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100; justify-content: center; align-items: center; }
    .upload-modal.active { display: flex; }
    .upload-box { background: white; border-radius: 12px; padding: 32px; max-width: 500px; width: 90%; }
    .upload-box h3 { margin-bottom: 16px; color: #1a237e; }
    .drop-zone { border: 2px dashed #ccc; border-radius: 8px; padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s; margin-bottom: 16px; }
    .drop-zone:hover, .drop-zone.drag-over { border-color: #1a237e; background: #e8eaf6; }
    .drop-zone p { color: #666; font-size: 14px; }
    .upload-list { max-height: 200px; overflow-y: auto; margin-bottom: 16px; }
    .upload-list .item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px; }
    .btn-row { display: flex; gap: 8px; justify-content: flex-end; }
    .btn { padding: 8px 20px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; }
    .btn-primary { background: #1a237e; color: white; }
    .btn-primary:hover { background: #283593; }
    .btn-cancel { background: #eee; color: #333; }
    .btn-cancel:hover { background: #ddd; }
    .progress { display: none; margin-bottom: 16px; }
    .progress-bar { height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden; }
    .progress-fill { height: 100%; background: #1a237e; width: 0%; transition: width 0.3s; }
    .status { font-size: 12px; color: #666; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <span class="logo">📁</span>
    <h1>Insurance Claims MIS - File Browser</h1>
  </div>

  <div class="breadcrumb" id="breadcrumb">Loading...</div>

  <div class="toolbar">
    <button class="upload-btn" onclick="openUpload()">
      📤 Upload Files
    </button>
    <div class="info" id="info"></div>
  </div>

  <div class="content">
    <div class="file-grid" id="fileGrid">Loading...</div>
  </div>

  <!-- Upload Modal -->
  <div class="upload-modal" id="uploadModal">
    <div class="upload-box">
      <h3>📤 Upload Files</h3>
      <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
        <p>📎 Click to select files or drag & drop here</p>
        <p style="font-size: 12px; color: #999; margin-top: 8px;">Max 50MB per file. All file types except executables.</p>
      </div>
      <input type="file" id="fileInput" multiple style="display:none" onchange="handleFiles(this.files)">
      <div class="upload-list" id="uploadList"></div>
      <div class="progress" id="progressBox">
        <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        <div class="status" id="progressStatus"></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-cancel" onclick="closeUpload()">Cancel</button>
        <button class="btn btn-primary" id="uploadBtn" onclick="doUpload()" disabled>Upload</button>
      </div>
    </div>
  </div>

  <script>
    const currentPath = ${JSON.stringify(currentPath)};
    const API_KEY = '${CONFIG.API_KEY}';
    let selectedFiles = [];

    // Load folder contents
    async function loadFolder() {
      try {
        const res = await fetch('/api/browse?path=' + encodeURIComponent(currentPath));
        const data = await res.json();

        // Breadcrumb
        const bc = document.getElementById('breadcrumb');
        bc.innerHTML = data.breadcrumb.map((b, i) =>
          (i < data.breadcrumb.length - 1)
            ? '<a href="/browse?path=' + encodeURIComponent(b.path) + '">' + b.name + '</a><span class="sep">▸</span>'
            : '<a href="#" style="font-weight:600;">' + b.name + '</a>'
        ).join('');

        // Info
        document.getElementById('info').textContent =
          data.totalFolders + ' folder(s), ' + data.totalFiles + ' file(s)';

        // Grid
        const grid = document.getElementById('fileGrid');
        if (data.items.length === 0) {
          grid.innerHTML = '<div class="empty"><div class="icon">📂</div><p>This folder is empty</p><p style="margin-top:8px;font-size:13px;">Upload files using the button above</p></div>';
          return;
        }

        grid.innerHTML = data.items.map(item => {
          if (item.type === 'folder') {
            return '<div class="file-item" onclick="window.location.href=\\'/browse?path=' + encodeURIComponent((currentPath ? currentPath + '\\\\\\\\' : '') + item.name) + '\\'">' +
              '<div class="icon">📁</div>' +
              '<div class="name">' + escapeHtml(item.name) + '</div>' +
              '<div class="meta">Folder</div></div>';
          } else {
            const icon = getFileIcon(item.extension);
            return '<div class="file-item" onclick="window.open(\\'' + item.downloadUrl + '&view=true\\', \\'_blank\\')">' +
              '<div class="icon">' + icon + '</div>' +
              '<div class="name">' + escapeHtml(item.name) + '</div>' +
              '<div class="meta">' + (item.sizeFormatted || '') + ' • ' + (item.modifiedFormatted || '') + '</div></div>';
          }
        }).join('');
      } catch (err) {
        document.getElementById('fileGrid').innerHTML =
          '<div class="empty"><div class="icon">⚠️</div><p>Error loading folder: ' + err.message + '</p></div>';
      }
    }

    function getFileIcon(ext) {
      const icons = {
        '.pdf': '📕', '.doc': '📘', '.docx': '📘', '.xls': '📗', '.xlsx': '📗',
        '.ppt': '📙', '.pptx': '📙', '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️',
        '.gif': '🖼️', '.bmp': '🖼️', '.txt': '📄', '.csv': '📊', '.zip': '📦',
        '.rar': '📦', '.mp4': '🎬', '.mp3': '🎵', '.wav': '🎵',
      };
      return icons[ext] || '📄';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Upload functionality
    function openUpload() {
      selectedFiles = [];
      document.getElementById('uploadList').innerHTML = '';
      document.getElementById('uploadBtn').disabled = true;
      document.getElementById('progressBox').style.display = 'none';
      document.getElementById('uploadModal').classList.add('active');
    }

    function closeUpload() {
      document.getElementById('uploadModal').classList.remove('active');
    }

    function handleFiles(files) {
      selectedFiles = Array.from(files);
      const list = document.getElementById('uploadList');
      list.innerHTML = selectedFiles.map(f =>
        '<div class="item"><span>' + escapeHtml(f.name) + '</span><span>' + formatSize(f.size) + '</span></div>'
      ).join('');
      document.getElementById('uploadBtn').disabled = selectedFiles.length === 0;
    }

    async function doUpload() {
      if (selectedFiles.length === 0) return;
      const formData = new FormData();
      formData.append('folder_path', currentPath);
      selectedFiles.forEach(f => formData.append('files', f));

      document.getElementById('progressBox').style.display = 'block';
      document.getElementById('progressFill').style.width = '30%';
      document.getElementById('progressStatus').textContent = 'Uploading...';
      document.getElementById('uploadBtn').disabled = true;

      try {
        const res = await fetch('/api/upload?folder_path=' + encodeURIComponent(currentPath), {
          method: 'POST',
          headers: { 'X-API-Key': API_KEY },
          body: formData
        });
        const data = await res.json();

        document.getElementById('progressFill').style.width = '100%';
        document.getElementById('progressStatus').textContent =
          data.success ? '✅ ' + data.message : '❌ ' + (data.error || 'Upload failed');

        if (data.success) {
          setTimeout(() => { closeUpload(); loadFolder(); }, 1000);
        }
      } catch (err) {
        document.getElementById('progressStatus').textContent = '❌ Error: ' + err.message;
      }
    }

    function formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Drag and drop
    const dz = document.getElementById('dropZone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });

    // Load on page load
    loadFolder();
  </script>
</body>
</html>`;
}

// ========== START SERVER ==========
app.listen(CONFIG.PORT, '0.0.0.0', () => {
  log('========================================');
  log('Insurance Claims MIS - File Server');
  log('========================================');
  log(`Server running on port ${CONFIG.PORT}`);
  log(`Base path: ${CONFIG.BASE_PATH}`);
  log(`Browse: http://localhost:${CONFIG.PORT}/browse`);
  log(`API: http://localhost:${CONFIG.PORT}/api/health`);
  log('');
  log('Endpoints:');
  log('  GET  /browse?path=...        - Web file browser');
  log('  GET  /api/browse?path=...    - List folder contents (JSON)');
  log('  GET  /api/download?path=...  - Download a file');
  log('  POST /api/upload             - Upload files (requires X-API-Key)');
  log('  POST /api/backup             - Database backup (requires X-API-Key)');
  log('  GET  /api/backups            - List existing backups');
  log('  GET  /api/folder-info?path=  - Check if folder exists');
  log('  GET  /api/health             - Health check');
  log('');
  log('SECURITY: No delete, rename, or move operations allowed.');
  log('Folders are protected and permanent.');
});
