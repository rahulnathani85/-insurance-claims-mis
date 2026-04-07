/**
 * Install the Folder Listener as a Windows Service
 *
 * Run this ONCE to install:
 *   node install-service.js
 *
 * The service will then auto-start on boot and restart on failure.
 *
 * To uninstall:
 *   node install-service.js --uninstall
 */

const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'Insurance Folder Listener',
  description: 'Auto-creates folders on D:\\2026-27 when claims/policies are registered in Insurance Claims MIS',
  script: path.join(__dirname, 'listener.js'),
  nodeOptions: [],
  workingDirectory: __dirname,
  // Auto-restart on failure
  wait: 5,       // 5 seconds between restarts
  grow: 0.5,     // grow restart interval by 50%
  maxRestarts: 10 // max restarts before stopping
});

if (process.argv.includes('--uninstall')) {
  svc.on('uninstall', () => {
    console.log('Service uninstalled successfully.');
    console.log('The service is now removed from Windows Services.');
  });
  svc.uninstall();
} else {
  svc.on('install', () => {
    console.log('');
    console.log('=== Service installed successfully! ===');
    console.log('');
    console.log('The "Insurance Folder Listener" service has been registered.');
    console.log('Starting the service now...');
    svc.start();
  });

  svc.on('start', () => {
    console.log('Service started!');
    console.log('');
    console.log('You can manage it from:');
    console.log('  - Windows Services (services.msc)');
    console.log('  - Or run: sc query "Insurance Folder Listener"');
    console.log('');
    console.log('To uninstall: node install-service.js --uninstall');
  });

  svc.on('alreadyinstalled', () => {
    console.log('Service is already installed.');
    console.log('To reinstall, first uninstall: node install-service.js --uninstall');
  });

  svc.on('error', (err) => {
    console.error('Error:', err);
  });

  svc.install();
}
