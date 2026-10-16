#!/usr/bin/env node
// Runs the whole application for local development with one command:
//
//   npm run dev
//
// Starts the Express API (backend/, ts-node-dev) and the Next.js app
// (frontend/, next dev) side by side, prefixes their output, and stops both
// when either one exits or you press Ctrl+C.
//
// Configuration comes from ONE file: the repo-root `.env` (copy .env.example).
// Values already exported in your shell win over the file. No dependencies —
// this script only uses Node built-ins.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotenv(file) {
  const vars = {};
  if (!existsSync(file)) return vars;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, ''); // trailing inline comment
    }
    vars[key] = value;
  }
  return vars;
}

const envFile = path.join(root, '.env');
if (!existsSync(envFile)) {
  console.warn('[dev] No .env found at the repo root — copy .env.example to .env first.\n');
}

const shared = { ...loadDotenv(envFile), ...process.env };
const apiPort = shared.BACKEND_PORT || '5000';
const webPort = shared.FRONTEND_PORT || '3000';

const services = [
  {
    name: 'api',
    color: '\x1b[36m',
    cwd: path.join(root, 'backend'),
    args: ['run', 'dev'],
    env: { ...shared, PORT: apiPort },
  },
  {
    name: 'web',
    color: '\x1b[35m',
    cwd: path.join(root, 'frontend'),
    args: ['run', 'dev', '--', '--port', webPort],
    env: {
      ...shared,
      PORT: webPort,
      NEXT_PUBLIC_API_URL: shared.NEXT_PUBLIC_API_URL || `http://localhost:${apiPort}`,
    },
  },
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

for (const svc of services) {
  const child = spawn(npm, svc.args, {
    cwd: svc.cwd,
    env: svc.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  children.push(child);
  const prefix = `${svc.color}[${svc.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + '\n');
    });
    stream.on('end', () => { if (buf) out.write(prefix + buf + '\n'); });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) console.error(`\n[dev] ${svc.name} exited (code ${code}) — stopping everything.`);
    stopAll(code ?? 1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
console.log(`[dev] API → http://localhost:${apiPort}   Web → http://localhost:${webPort}\n`);
