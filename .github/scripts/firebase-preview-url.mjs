import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function collectUrls(value, output) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
    return;
  }
  if (typeof value.url === 'string') output.push(value.url);
  for (const item of Object.values(value)) collectUrls(item, output);
}

export function extractPreviewUrl(output, channel) {
  if (typeof output !== 'string' || typeof channel !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(channel)) {
    throw new TypeError('Invalid Firebase preview output or channel');
  }
  const parsed = [];
  const text = output.trim();
  try {
    parsed.push(JSON.parse(text));
  } catch {
    for (const line of text.split(/\r?\n/)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
  }
  const urls = [];
  const expectedHost = new RegExp(`^lvrooms--${channel}-[a-z0-9]+\\.web\\.app$`);
  for (const value of parsed) collectUrls(value, urls);
  const matching = [...new Set(urls)].filter((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && expectedHost.test(url.hostname) && url.pathname === '/';
    } catch {
      return false;
    }
  });
  if (matching.length !== 1) throw new Error('Firebase did not return exactly one preview URL for the expected site and channel');
  return matching[0];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [, , outputPath, channel] = process.argv;
  if (!outputPath || !channel) {
    console.error('usage: node firebase-preview-url.mjs <firebase-json-output> <channel>');
    process.exit(2);
  }
  try {
    const url = extractPreviewUrl(await readFile(outputPath, 'utf8'), channel);
    process.stdout.write(`url=${url}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
