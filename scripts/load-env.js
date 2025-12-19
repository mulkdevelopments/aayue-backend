#!/usr/bin/env node

/**
 * Environment Loader Script
 *
 * Loads the appropriate .env file based on the environment
 * Usage: node scripts/load-env.js [local|docker]
 */

const fs = require('fs');
const path = require('path');

const envType = process.argv[2] || 'local';
const envFile = `.env.${envType}`;
const envPath = path.join(__dirname, '..', envFile);
const targetPath = path.join(__dirname, '..', '.env');

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

if (!fs.existsSync(envPath)) {
  log(`\n❌ Environment file not found: ${envFile}`, colors.red);
  log(`\nAvailable options:`, colors.yellow);
  log(`  - local  (.env.local)  - Production DB via SSH tunnel`, colors.dim);
  log(`  - docker (.env.docker) - Local Docker DB`, colors.dim);
  process.exit(1);
}

// Copy the selected env file to .env
fs.copyFileSync(envPath, targetPath);

log(`\n✅ Loaded environment: ${envType}`, colors.green);

if (envType === 'local') {
  log(`\n📝 Using production database via SSH tunnel`, colors.cyan);
  log(`   Make sure tunnel is running: npm run db:tunnel`, colors.yellow);
  log(`   Connection: localhost:5433`, colors.dim);
} else if (envType === 'docker') {
  log(`\n📝 Using local Docker database`, colors.cyan);
  log(`   Connection: postgres:5432 (Docker network)`, colors.dim);
}

log(``);
