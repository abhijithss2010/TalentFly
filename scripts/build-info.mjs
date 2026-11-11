import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

function gitValue(command, cwd) {
  try {
    return execFileSync('git', command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function createBuildInfo(packagePath) {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

  return {
    version: packageJson.version,
    commit:
      process.env.BUILD_COMMIT ??
      process.env.GITHUB_SHA ??
      gitValue(['rev-parse', 'HEAD'], dirname(packagePath)),
    builtAt: process.env.BUILD_TIME ?? new Date().toISOString(),
  };
}
