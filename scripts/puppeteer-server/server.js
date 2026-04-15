/**
 * NISLA MIS - Puppeteer PDF Generation Server
 *
 * Runs on port 4001 alongside the file server (port 4000).
 * Accepts HTML content and returns PDF or saves to a folder.
 *
 * Setup:
 *   1. npm init -y
 *   2. npm install express cors puppeteer
 *   3. node server.js
 *
 * Endpoints:
 *   POST /api/html-to-pdf  — Convert HTML to PDF
 *     Body: { html: "...", folder_path: "..." (optional), filename: "report.pdf" (optional) }
 *     If folder_path provided: saves PDF to D:\2026-27\{folder_path}\{filename} and returns JSON
 *     If no folder_path: returns PDF binary directly
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const PORT = 4001;
const BASE_PATH = 'D:\\2026-27';
const API_KEY = 'nisla-file-server-2026';

const app = express();

app.use(cors({
  origin: [
    'https://insurance-claims-mis-1kl7.vercel.app',
    'https://insurance-claims-mis.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json({ limit: '10mb' }));

// API key check
function checkKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'NISLA Puppeteer PDF Server', port: PORT });
});

// HTML to PDF conversion
app.post('/api/html-to-pdf', checkKey, async (req, res) => {
  const { html, folder_path, filename } = req.body;

  if (!html) return res.status(400).json({ error: 'html content required' });

  let browser;
  try {
    const puppeteer = require('puppeteer');

    console.log(`[${new Date().toLocaleTimeString()}] Generating PDF...`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    console.log(`[${new Date().toLocaleTimeString()}] PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    // If folder_path provided, save to disk
    if (folder_path && filename) {
      const fullPath = path.resolve(BASE_PATH, folder_path);

      // Security: make sure path is within BASE_PATH
      if (!fullPath.startsWith(BASE_PATH)) {
        return res.status(400).json({ error: 'Invalid folder path' });
      }

      // Create folder if needed
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }

      const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');
      const pdfPath = path.join(fullPath, safeName);
      fs.writeFileSync(pdfPath, pdfBuffer);

      console.log(`[${new Date().toLocaleTimeString()}] PDF saved: ${pdfPath}`);

      return res.json({
        success: true,
        message: 'PDF generated and saved',
        path: pdfPath,
        size: pdfBuffer.length,
        sizeFormatted: `${(pdfBuffer.length / 1024).toFixed(1)} KB`,
      });
    }

    // No folder_path: return PDF binary
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename || 'report.pdf'}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(Buffer.from(pdfBuffer));

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`[${new Date().toLocaleTimeString()}] PDF error:`, err.message);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('==========================================');
  console.log('  NISLA MIS - Puppeteer PDF Server');
  console.log('==========================================');
  console.log(`  Port: ${PORT}`);
  console.log(`  Base path: ${BASE_PATH}`);
  console.log(`  Endpoint: POST /api/html-to-pdf`);
  console.log(`  Health: GET /api/health`);
  console.log('==========================================');
});
