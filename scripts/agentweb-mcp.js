#!/usr/bin/env node
// Agent Web's own MCP server (stdio, newline-delimited JSON-RPC 2.0).
//  - share_file: hands files to the user; the web server sees the result and
//    shows them in the chat as download cards (see server/chat.js).
// No dependencies on purpose: it starts fast and needs nothing from npm.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const SERVER_INFO = { name: 'agentweb', version: '1.0.0' };
const MAX_SHARE_FILES = 10;
const MAX_SHARE_BYTES = 50 * 1024 * 1024;
const MAX_SHARE_TOTAL = 100 * 1024 * 1024;
const SYSTEM_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;

const TOOLS = [
  {
    name: 'share_file',
    title: 'Dosya paylaş',
    description:
      'Send files from this machine to the user: they appear in the Agent Web chat as download cards ' +
      '(images also get a preview). Use it whenever the user asks you to send, share or give them a file, ' +
      'or when a result is better delivered as a file than as pasted text (long code, logs, CSV, documents, ' +
      'archives, images). Write the file first, then call this with its path. Folders cannot be shared; ' +
      'archive them first (zip/tar). At most 10 files, 50 MB each.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_SHARE_FILES,
          description: 'File paths, absolute or relative to the current working directory.',
        },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    annotations: { title: 'Dosya paylaş', readOnlyHint: true, openWorldHint: false },
  },
];

class ToolError extends Error {}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function text(value) {
  return { type: 'text', text: value };
}

function shareFile(args) {
  let raw = args.paths;
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw) || !raw.length) throw new ToolError('paths en az bir dosya yolu içermeli.');
  if (raw.length > MAX_SHARE_FILES) throw new ToolError(`Tek seferde en fazla ${MAX_SHARE_FILES} dosya paylaşılabilir.`);
  const files = [];
  let total = 0;
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new ToolError('Geçersiz dosya yolu.');
    const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
    const abs = path.resolve(process.cwd(), expanded);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new ToolError(`Dosya bulunamadı: ${value}`);
    }
    if (stat.isDirectory()) throw new ToolError(`${value} bir klasör; önce zip ya da tar ile arşivleyip arşivi paylaşın.`);
    if (!stat.isFile()) throw new ToolError(`${value} normal bir dosya değil.`);
    // /proc and friends look like regular files but hold live process state
    // (environment variables, memory maps) that should never leave the box.
    if (SYSTEM_PATH_RE.test(fs.realpathSync(abs))) throw new ToolError(`${value} bir sistem dosyası; paylaşılamaz.`);
    if (stat.size > MAX_SHARE_BYTES) throw new ToolError(`${value} çok büyük (${formatBytes(stat.size)}; en fazla 50 MB).`);
    try {
      fs.accessSync(abs, fs.constants.R_OK);
    } catch {
      throw new ToolError(`${value} okunamıyor (izin yok).`);
    }
    total += stat.size;
    if (total > MAX_SHARE_TOTAL) throw new ToolError('Dosyaların toplamı 100 MB\'ı aşıyor; daha az dosya paylaşın.');
    files.push({ path: fs.realpathSync(abs), name: path.basename(abs), size: stat.size });
  }
  const summary = files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ');
  return [
    text(`Paylaşıldı: ${summary}. Agent Web sohbetinde indirme kartı olarak görünür.`),
    text(JSON.stringify({ agentwebShare: files })),
  ];
}

const HANDLERS = {
  share_file: shareFile,
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function listedTools() {
  return TOOLS;
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  if (!method) return;
  if (!isRequest) return; // notifications (initialized, cancelled, ...)
  try {
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(requested || '') ? requested : '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: 'Agent Web tools. share_file sends files to the user in the chat.',
          },
        });
        return;
      }
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} });
        return;
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: listedTools() } });
        return;
      case 'tools/call': {
        const name = params && params.name;
        const listed = listedTools().some((tool) => tool.name === name);
        const handler = listed && Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : null;
        if (!handler) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          return;
        }
        try {
          const content = await handler((params && params.arguments) || {});
          send({ jsonrpc: '2.0', id, result: { content } });
        } catch (err) {
          const messageText = err instanceof ToolError ? err.message : `Hata: ${err && err.message ? err.message : String(err)}`;
          send({ jsonrpc: '2.0', id, result: { content: [text(messageText)], isError: true } });
        }
        return;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err && err.message ? err.message : String(err) } });
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    for (const item of Array.isArray(message) ? message : [message]) {
      if (item && typeof item === 'object') handle(item);
    }
  });
  rl.on('close', () => process.exit(0));
}

module.exports = { TOOLS, HANDLERS };
