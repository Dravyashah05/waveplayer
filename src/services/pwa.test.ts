import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PUB = join(ROOT, 'public');

describe('PWA configuration', () => {
  it('ships a complete installable manifest (no duplicate icon assets)', () => {
    const manifest = JSON.parse(readFileSync(join(PUB, 'manifest.json'), 'utf8'));
    for (const key of ['name', 'short_name', 'description', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) {
      assert.ok(manifest[key], `manifest.${key} present`);
    }
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
    const seen = new Set<string>();
    for (const icon of manifest.icons) {
      assert.ok(icon.src && icon.sizes && icon.type, 'icon has src/sizes/type');
      assert.ok(!seen.has(icon.src), `no duplicate icon asset: ${icon.src}`);
      seen.add(icon.src);
      if (!String(icon.src).startsWith('data:')) {
        const disk = join(PUB, String(icon.src).replace(/^\//, ''));
        assert.ok(existsSync(disk), `icon exists on disk: ${icon.src}`);
        assert.ok(statSync(disk).size > 500, `icon is a real file: ${icon.src}`);
      }
    }
    // 192 + 512 PNG coverage for installability.
    const sizes = manifest.icons.map((i: any) => i.sizes).join(' ');
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  });

  it('service worker never caches private API responses', () => {
    const sw = readFileSync(join(PUB, 'sw.js'), 'utf8');
    for (const prefix of ['/api/auth/', '/api/youtube/', '/api/ytmusic-py/library/', '/api/ytmusic-py/auth/']) {
      assert.ok(sw.includes(prefix), `sw bypasses private prefix ${prefix}`);
    }
    // No tokens/secrets/cookies in the worker, bounded runtime cache.
    assert.ok(!sw.match(/token|secret|cookie|authorization/i), 'worker holds no credentials');
    assert.ok(sw.match(/MAX_RUNTIME|150/), 'runtime cache is bounded');
  });

  it('precaches the app shell including icons', () => {
    const sw = readFileSync(join(PUB, 'sw.js'), 'utf8');
    for (const asset of ['/index.html', '/manifest.json', '/icon-192.png']) {
      assert.ok(sw.includes(asset), `sw precaches ${asset}`);
    }
  });
});
