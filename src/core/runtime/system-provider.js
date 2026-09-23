'use strict';

const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('../config');
const execFileAsync = promisify(execFile);
const SAFE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

async function run(action, args = [], options = {}) {
  const commandArgs = ['-n', '--', config.controlBinary, action, ...args.map(String)];
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/sudo', commandArgs, {
      timeout: options.timeout || 20000,
      maxBuffer: options.maxBuffer || 1024 * 1024,
      env: { PATH: SAFE_PATH },
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const message = String(error.stderr || error.message || 'Perintah privileged gagal').trim();
    const wrapped = new Error(message);
    wrapped.code = error.code;
    throw wrapped;
  }
}

function runWithInput(action, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sudo', ['-n', '--', config.controlBinary, action], {
      env: { PATH: SAFE_PATH }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = ''; let settled = false;
    const maxBuffer = options.maxBuffer || 1024 * 1024;
    const timeoutMs = options.timeout || 20000;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL'); settled = true;
      reject(new Error(`Perintah privileged timeout setelah ${timeoutMs} ms.`));
    }, timeoutMs);
    const append = (kind, chunk) => {
      const value = chunk.toString('utf8');
      if (kind === 'stdout') stdout += value; else stderr += value;
      if (stdout.length + stderr.length > maxBuffer && !settled) {
        child.kill('SIGKILL'); settled = true; clearTimeout(timer);
        reject(new Error('Output privileged helper terlalu besar.'));
      }
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code === 0) return resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() });
      const wrapped = new Error((stderr || stdout || `Privileged helper keluar dengan kode ${code}`).trim());
      wrapped.code = code; reject(wrapped);
    });
    child.stdin.end(String(input ?? ''));
  });
}

module.exports = { run, runWithInput };
