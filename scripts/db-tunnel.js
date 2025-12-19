#!/usr/bin/env node

/**
 * SSH Tunnel Manager for Production Services Access
 *
 * This script manages SSH tunnels to production services (PostgreSQL, Redis, Elasticsearch).
 * It allows local development against production data securely.
 *
 * Usage:
 *   npm run db:tunnel          - Start all tunnels in foreground
 *   npm run db:tunnel:start    - Start all tunnels in background
 *   npm run db:tunnel:stop     - Stop background tunnels
 *   npm run db:tunnel:status   - Check tunnel status
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Configuration
const CONFIG = {
  keyPath: path.join(os.homedir(), 'Downloads', 'aayeu-ecom-key.pem'),
  remoteHost: 'ec2-16-171-230-120.eu-north-1.compute.amazonaws.com',
  remoteUser: 'ubuntu',
  // PostgreSQL tunnel
  localPortPg: 5433,
  remotePortPg: 5432,
  // Redis tunnel
  localPortRedis: 6380,
  remotePortRedis: 6379,
  // Elasticsearch tunnel (optional)
  localPortEs: 9201,
  remotePortEs: 9200,
  pidFile: path.join(__dirname, '.tunnel.pid')
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkKeyFile() {
  if (!fs.existsSync(CONFIG.keyPath)) {
    log(`\n❌ SSH key not found at: ${CONFIG.keyPath}`, colors.red);
    log(`\nPlease ensure your key file is in the correct location.`, colors.yellow);
    log(`Expected location: ${CONFIG.keyPath}`, colors.dim);
    process.exit(1);
  }

  // Check permissions on Unix-like systems
  if (process.platform !== 'win32') {
    const stats = fs.statSync(CONFIG.keyPath);
    const mode = stats.mode & parseInt('777', 8);
    if (mode !== parseInt('400', 8) && mode !== parseInt('600', 8)) {
      log(`\n⚠️  Warning: SSH key has incorrect permissions`, colors.yellow);
      log(`Run: chmod 400 ${CONFIG.keyPath}`, colors.cyan);
    }
  }
}

function startTunnel(background = false) {
  checkKeyFile();

  log(`\n🔧 Starting SSH tunnels to production services...`, colors.cyan);
  log(`   PostgreSQL:     localhost:${CONFIG.localPortPg} → ${CONFIG.remoteHost}:${CONFIG.remotePortPg}`, colors.dim);
  log(`   Redis:          localhost:${CONFIG.localPortRedis} → ${CONFIG.remoteHost}:${CONFIG.remotePortRedis}`, colors.dim);
  log(`   Elasticsearch:  localhost:${CONFIG.localPortEs} → ${CONFIG.remoteHost}:${CONFIG.remotePortEs}`, colors.dim);

  const sshArgs = [
    '-i', CONFIG.keyPath,
    // PostgreSQL tunnel
    '-L', `${CONFIG.localPortPg}:localhost:${CONFIG.remotePortPg}`,
    // Redis tunnel
    '-L', `${CONFIG.localPortRedis}:localhost:${CONFIG.remotePortRedis}`,
    // Elasticsearch tunnel
    '-L', `${CONFIG.localPortEs}:localhost:${CONFIG.remotePortEs}`,
    `${CONFIG.remoteUser}@${CONFIG.remoteHost}`,
    '-N', // No remote command
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=60',
    '-o', 'ServerAliveCountMax=3'
  ];

  if (background) {
    sshArgs.push('-f'); // Background mode
  }

  const tunnel = spawn('ssh', sshArgs, {
    stdio: background ? 'ignore' : 'inherit',
    detached: background
  });

  if (background) {
    fs.writeFileSync(CONFIG.pidFile, tunnel.pid.toString());

    // Give it a moment to establish connection
    setTimeout(() => {
      checkTunnelStatus(true);
    }, 2000);

    tunnel.unref();
  } else {
    log(`\n✅ Tunnels established!`, colors.green);
    log(`   PostgreSQL:     localhost:${CONFIG.localPortPg}`, colors.green);
    log(`   Redis:          localhost:${CONFIG.localPortRedis}`, colors.green);
    log(`   Elasticsearch:  localhost:${CONFIG.localPortEs}`, colors.green);
    log(`\n   Press Ctrl+C to stop the tunnels\n`, colors.dim);

    tunnel.on('close', (code) => {
      if (code !== 0) {
        log(`\n❌ Tunnels closed with code ${code}`, colors.red);
      } else {
        log(`\n👋 Tunnels closed`, colors.yellow);
      }
      cleanupPidFile();
    });

    process.on('SIGINT', () => {
      log(`\n\n🛑 Stopping tunnels...`, colors.yellow);
      tunnel.kill();
      process.exit(0);
    });
  }

  tunnel.on('error', (err) => {
    log(`\n❌ Failed to start tunnels: ${err.message}`, colors.red);
    cleanupPidFile();
    process.exit(1);
  });
}

function stopTunnel() {
  if (!fs.existsSync(CONFIG.pidFile)) {
    log(`\n⚠️  No running tunnels found`, colors.yellow);
    return;
  }

  const pid = fs.readFileSync(CONFIG.pidFile, 'utf8').trim();

  try {
    log(`\n🛑 Stopping tunnels (PID: ${pid})...`, colors.yellow);

    if (process.platform === 'win32') {
      exec(`taskkill /PID ${pid} /F`, (error) => {
        if (error) {
          log(`❌ Failed to stop tunnels: ${error.message}`, colors.red);
        } else {
          log(`✅ Tunnels stopped`, colors.green);
          cleanupPidFile();
        }
      });
    } else {
      process.kill(parseInt(pid), 'SIGTERM');
      log(`✅ Tunnels stopped`, colors.green);
      cleanupPidFile();
    }
  } catch (err) {
    if (err.code === 'ESRCH') {
      log(`⚠️  Process not found, cleaning up...`, colors.yellow);
      cleanupPidFile();
    } else {
      log(`❌ Error stopping tunnels: ${err.message}`, colors.red);
    }
  }
}

function checkTunnelStatus(silent = false) {
  if (!fs.existsSync(CONFIG.pidFile)) {
    if (!silent) log(`\n⚪ Tunnels are not running`, colors.dim);
    return false;
  }

  const pid = fs.readFileSync(CONFIG.pidFile, 'utf8').trim();

  try {
    process.kill(parseInt(pid), 0); // Check if process exists
    if (!silent) {
      log(`\n✅ Tunnels are running (PID: ${pid})`, colors.green);
      log(`   PostgreSQL:     localhost:${CONFIG.localPortPg}`, colors.dim);
      log(`   Redis:          localhost:${CONFIG.localPortRedis}`, colors.dim);
      log(`   Elasticsearch:  localhost:${CONFIG.localPortEs}`, colors.dim);
      log(`   Remote:         ${CONFIG.remoteHost}`, colors.dim);
    }
    return true;
  } catch (err) {
    if (!silent) {
      log(`\n⚠️  Tunnel process not found, cleaning up...`, colors.yellow);
    }
    cleanupPidFile();
    return false;
  }
}

function cleanupPidFile() {
  if (fs.existsSync(CONFIG.pidFile)) {
    fs.unlinkSync(CONFIG.pidFile);
  }
}

function showHelp() {
  log(`\n${colors.cyan}SSH Tunnel Manager for Production Services${colors.reset}\n`);
  log(`Usage:`);
  log(`  npm run db:tunnel          Start tunnels in foreground (recommended for development)`);
  log(`  npm run db:tunnel:start    Start tunnels in background`);
  log(`  npm run db:tunnel:stop     Stop background tunnels`);
  log(`  npm run db:tunnel:status   Check tunnel status\n`);
  log(`Services Tunneled:`);
  log(`  PostgreSQL:     localhost:${CONFIG.localPortPg} → ${CONFIG.remotePortPg}`, colors.dim);
  log(`  Redis:          localhost:${CONFIG.localPortRedis} → ${CONFIG.remotePortRedis}`, colors.dim);
  log(`  Elasticsearch:  localhost:${CONFIG.localPortEs} → ${CONFIG.remotePortEs}`, colors.dim);
  log(`\nRemote Host:`, colors.dim);
  log(`  ${CONFIG.remoteHost}`, colors.dim);
  log(`  Key: ${CONFIG.keyPath}`, colors.dim);
  log(``);
}

// Main
const command = process.argv[2] || 'foreground';

switch (command) {
  case 'start':
    startTunnel(true);
    break;
  case 'stop':
    stopTunnel();
    break;
  case 'status':
    checkTunnelStatus();
    break;
  case 'foreground':
  case 'fg':
    startTunnel(false);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    log(`\n❌ Unknown command: ${command}`, colors.red);
    showHelp();
    process.exit(1);
}
