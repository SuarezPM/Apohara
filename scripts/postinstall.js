#!/usr/bin/env node

/**
 * Postinstall script for clarity-code npm package.
 * Extracts the correct platform-specific binary from optionalDependencies.
 * Works as both ESM and CommonJS.
 */

import { mkdirSync, existsSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { platform, arch } from 'os';
import { createRequire } from 'module';

// ESM-compatible way to get the directory of this script
const getScriptDir = () => {
  // Use import.meta.url for ESM, __dirname for CommonJS
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return dirname(fileURLToPath(import.meta.url));
  }
  // Fallback for CommonJS
  try {
    const require = createRequire(import.meta.url || __filename);
    return dirname(require.main?.filename || __filename);
  } catch {
    return dirname(__filename);
  }
};

// Helper for ESM
function fileURLToPath(url) {
  if (typeof url === 'string') return url;
  return url.pathname;
}

const platformMap = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win32'
};

const archMap = {
  x64: 'x64',
  arm64: 'arm64'
};

const currentPlatform = platformMap[platform()] || 'linux';
const currentArch = archMap[arch()] || 'x64';
const packageName = `@clarity-code/cli-${currentPlatform}-${currentArch}`;

const scriptDir = getScriptDir();
const binariesDir = join(scriptDir, '..', 'binaries');

// Ensure binaries directory exists
if (!existsSync(binariesDir)) {
  mkdirSync(binariesDir, { recursive: true });
}

// Try to find the binary in optionalDependencies
try {
  // Use createRequire to resolve the optional dependency
  const require = createRequire(import.meta.url);
  const binaryPath = require.resolve(`${packageName}/bin/clarity`);
  const destPath = join(binariesDir, 'clarity');

  if (existsSync(binaryPath)) {
    copyFileSync(binaryPath, destPath);
    console.log(`✅ Extracted ${packageName} binary to binaries/`);
  }
} catch {
  // Optional dependency not available - this is fine for platforms we don't support
  console.log(`ℹ️  No prebuilt binary for ${currentPlatform}-${currentArch} (optional)`);
}

// Create a marker file indicating this is the npm package
const markerPath = join(binariesDir, '.npm-package');
try {
  writeFileSync(markerPath, 'npm-package\n');
} catch {
  // Ignore errors
}