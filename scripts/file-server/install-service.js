/**
 * Install the File Server as a Windows Service
 * Run: node install-service.js
 * Uninstall: node install-service.js --uninstall
 */

const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'Insurance File Server',
  description: 'File server for Insurance Claims MIS - serves D:\\2026-27 folders with upload support',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [],
  workingDirectory: __dirname,
  wait: 5,
  grow: 0.5,
  maxRestarts: 10
});

if (process.argv.includes('--uninstall')) {
  svc.on('uninstall', () => console.log('Service uninstalled successfully.'));
  svc.uninstall();
} else {
  svc.on('install', () => { console.log('Service installed! Starting...'); svc.start(); });
  svc.on('start', () => {
    console.log('Insurance File Server is now running as a Windows service on port 4000.');
    console.log('Manage via: services.msc');
    console.log('Uninstall: node install-service.js --uninstall');
  });
  svc.on('alreadyinstalled', () => console.log('Already installed. Uninstall first: node install-service.js --uninstall'));
  svc.on('error', (err) => console.error('Error:', err));
  svc.install();
}
