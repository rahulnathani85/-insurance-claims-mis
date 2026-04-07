/**
 * Insurance Claims MIS - Realtime Folder Listener
 *
 * This service listens to Supabase Realtime for new claims and policies,
 * and automatically creates the corresponding folders on D:\2026-27\
 *
 * Setup:
 *   1. Copy this folder to your cloud server
 *   2. Run: npm install
 *   3. Run: node listener.js (or install as Windows service)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ========== CONFIGURATION ==========
const SUPABASE_URL = 'https://ffljqrcavjkfpkvvsvza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmbGpxcmNhdmprZnBrdnZzdnphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzA0NTUsImV4cCI6MjA5MDUwNjQ1NX0.2L0PSlrdum5hFkB18os1yaw3pMaOcXVCeHBADK3Hn8o';
const BASE_PATH = 'D:\\2026-27';

// ========== SUPABASE CLIENT ==========
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

// ========== LOGGING ==========
function log(message, type = 'INFO') {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const prefix = {
    'INFO': '\x1b[36m[INFO]\x1b[0m',
    'SUCCESS': '\x1b[32m[SUCCESS]\x1b[0m',
    'ERROR': '\x1b[31m[ERROR]\x1b[0m',
    'WARN': '\x1b[33m[WARN]\x1b[0m',
    'LISTEN': '\x1b[35m[LISTENING]\x1b[0m'
  }[type] || '[INFO]';

  console.log(`${prefix} [${timestamp}] ${message}`);

  // Also write to log file
  const logLine = `[${type}] [${timestamp}] ${message}\n`;
  const logFile = path.join(__dirname, 'folder-listener.log');
  fs.appendFileSync(logFile, logLine);
}

// ========== FOLDER CREATION ==========
function createFolder(folderPath) {
  if (!folderPath) {
    log('No folder path provided, skipping', 'WARN');
    return false;
  }

  try {
    if (fs.existsSync(folderPath)) {
      log(`Folder already exists: ${folderPath}`, 'INFO');
      return true;
    }

    fs.mkdirSync(folderPath, { recursive: true });
    log(`Folder created: ${folderPath}`, 'SUCCESS');
    return true;
  } catch (err) {
    log(`Failed to create folder: ${folderPath} - ${err.message}`, 'ERROR');
    return false;
  }
}

// ========== CREATE EXISTING FOLDERS (on startup) ==========
async function createExistingFolders() {
  log('Creating folders for existing claims and policies...');

  // Ensure base directory exists
  if (!fs.existsSync(BASE_PATH)) {
    fs.mkdirSync(BASE_PATH, { recursive: true });
    log(`Created base directory: ${BASE_PATH}`, 'SUCCESS');
  }

  // Fetch all claims with folder paths
  const { data: claims, error: claimsError } = await supabase
    .from('claims')
    .select('id, ref_number, folder_path')
    .not('folder_path', 'is', null);

  if (claimsError) {
    log(`Error fetching claims: ${claimsError.message}`, 'ERROR');
  } else {
    let created = 0;
    for (const claim of claims || []) {
      if (claim.folder_path && !fs.existsSync(claim.folder_path)) {
        if (createFolder(claim.folder_path)) created++;
      }
    }
    log(`Claims: ${claims?.length || 0} total, ${created} new folders created`);
  }

  // Fetch all policies with folder paths
  const { data: policies, error: policiesError } = await supabase
    .from('policies')
    .select('id, policy_number, folder_path')
    .not('folder_path', 'is', null);

  if (policiesError) {
    log(`Error fetching policies: ${policiesError.message}`, 'ERROR');
  } else {
    let created = 0;
    for (const policy of policies || []) {
      if (policy.folder_path && !fs.existsSync(policy.folder_path)) {
        if (createFolder(policy.folder_path)) created++;
      }
    }
    log(`Policies: ${policies?.length || 0} total, ${created} new folders created`);
  }
}

// ========== REALTIME LISTENERS ==========
function startListening() {
  log('========================================');
  log('Insurance Claims MIS - Folder Listener');
  log('========================================');
  log(`Base Path: ${BASE_PATH}`);
  log('');

  // Listen for NEW claims
  const claimsChannel = supabase
    .channel('claims-folder-listener')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'claims'
      },
      (payload) => {
        const claim = payload.new;
        log(`New claim registered: ${claim.ref_number || claim.id}`);

        if (claim.folder_path) {
          createFolder(claim.folder_path);
        } else {
          log(`Claim ${claim.ref_number || claim.id} has no folder_path`, 'WARN');
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'claims',
        filter: 'folder_path=neq.'
      },
      (payload) => {
        const claim = payload.new;
        const oldClaim = payload.old;

        // Only create folder if folder_path changed
        if (claim.folder_path && claim.folder_path !== oldClaim.folder_path) {
          log(`Claim updated with new folder path: ${claim.ref_number || claim.id}`);
          createFolder(claim.folder_path);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        log('Listening for new CLAIMS...', 'LISTEN');
      } else if (status === 'CHANNEL_ERROR') {
        log('Claims channel error - will retry...', 'ERROR');
      }
    });

  // Listen for NEW policies
  const policiesChannel = supabase
    .channel('policies-folder-listener')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'policies'
      },
      (payload) => {
        const policy = payload.new;
        log(`New policy added: ${policy.policy_number || policy.id}`);

        if (policy.folder_path) {
          createFolder(policy.folder_path);
        } else {
          log(`Policy ${policy.policy_number || policy.id} has no folder_path`, 'WARN');
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'policies',
        filter: 'folder_path=neq.'
      },
      (payload) => {
        const policy = payload.new;
        const oldPolicy = payload.old;

        if (policy.folder_path && policy.folder_path !== oldPolicy.folder_path) {
          log(`Policy updated with new folder path: ${policy.policy_number || policy.id}`);
          createFolder(policy.folder_path);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        log('Listening for new POLICIES...', 'LISTEN');
      } else if (status === 'CHANNEL_ERROR') {
        log('Policies channel error - will retry...', 'ERROR');
      }
    });

  // Listen for NEW survey fee bills (create bill-specific subfolder)
  const billsChannel = supabase
    .channel('bills-folder-listener')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'survey_fee_bills'
      },
      (payload) => {
        const bill = payload.new;
        log(`New survey fee bill generated: ${bill.bill_number || bill.id}`);

        // If bill is linked to a claim, ensure claim folder exists
        if (bill.claim_id) {
          supabase
            .from('claims')
            .select('folder_path')
            .eq('id', bill.claim_id)
            .single()
            .then(({ data }) => {
              if (data?.folder_path) {
                createFolder(data.folder_path);
                // Create a "Survey Fee Bills" subfolder inside the claim folder
                const billsSubfolder = path.join(data.folder_path, 'Survey Fee Bills');
                createFolder(billsSubfolder);
              }
            });
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        log('Listening for new SURVEY FEE BILLS...', 'LISTEN');
      }
    });

  // Heartbeat - log status every 30 minutes
  setInterval(() => {
    log('Heartbeat - Listener is active and running');
  }, 30 * 60 * 1000);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down listener...');
    supabase.removeAllChannels();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Shutting down listener...');
    supabase.removeAllChannels();
    process.exit(0);
  });
}

// ========== MAIN ==========
async function main() {
  // First, create folders for any existing claims/policies
  await createExistingFolders();

  log('');
  log('Starting Realtime listener...');
  log('Folders will be created automatically when new claims/policies are registered.');
  log('Press Ctrl+C to stop.\n');

  // Then start listening for new ones
  startListening();
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`, 'ERROR');
  process.exit(1);
});
