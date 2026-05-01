#!/usr/bin/env node

/**
 * Postinstall script for clarity-code npm package.
 * Extracts the correct platform-specific binary from optionalDependencies.
 */

import { mkdirSync, existsSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { platform, arch } from 'os';

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

const binariesDir = join(dirname(require.main?.filename || '.'), '..', 'binaries');

// Ensure binaries directory exists
if (!existsSync(binariesDir)) {
  mkdirSync(binariesDir, { recursive: true });
}

// Try to find the binary in optionalDependencies
try {
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
  require('fs').writeFileSync(markerPath, 'npm-package\n');
} catch {
  // Ignore errors
}