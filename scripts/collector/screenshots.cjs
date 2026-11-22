'use strict';

const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const PERIOD_MS = 60_000;
const EVENT_SPACING_MS = 10_000;
const EVENT_TYPES = new Set([
  'waiting', 'stalled', 'error', 'ended', 'network_offline', 'network_online', 'server_disconnect',
  'lease_refresh_started', 'lease_refresh_confirmed', 'lease_refresh_failed', 'lease_refresh_retry'
]);
const CHAT_STATES = new Set(['Connected', 'Closing', 'Closed', 'Error']);

function screenshotClip() {
  const panel = document.getElementById('chat-panel');
  if (!panel || panel.hidden || document.hidden || window.scrollX !== 0 || window.scrollY !== 0) return null;
  const rect = panel.getBoundingClientRect();
  const x = Math.max(0, Math.ceil(rect.left));
  const y = Math.max(0, Math.ceil(rect.top));
  const width = Math.floor(Math.min(rect.right, window.innerWidth)) - x;
  const height = Math.floor(Math.min(rect.bottom, window.innerHeight)) - y;
  if (width < 1 || height < 1) return null;
  return { x, y, width, height, scale: 1 };
}

function createScreenshots(folder, takeScreenshot, record, now = () => performance.now()) {
  const destination = path.join(folder, 'screenshots');
  const pending = new Set();
  let nextPeriodic = 0;
  let lastAttempt = -Infinity;
  let index = 0;
  let disabled = false;
  let interrupted = false;
  return {
    observe(event) {
      if (EVENT_TYPES.has(event.kind)) pending.add(event.kind);
      if (event.kind === 'waiting' || event.kind === 'stalled') interrupted = true;
      if (event.kind === 'playing' && interrupted) {
        pending.add('player_recovered');
        interrupted = false;
      }
      if (event.kind === 'chat_state' && CHAT_STATES.has(event.state)) pending.add('chat_' + event.state.toLowerCase());
    },
    async checkpoint(elapsedMs, final = false) {
      if (disabled || (elapsedMs < nextPeriodic && !pending.size && !final)) return;
      if (!final && elapsedMs - lastAttempt < EVENT_SPACING_MS) return;
      const triggers = [...pending];
      pending.clear();
      if (elapsedMs >= nextPeriodic) triggers.push(nextPeriodic === 0 ? 'inicio' : 'periodica');
      if (final) triggers.push('fim');
      nextPeriodic = (Math.floor(elapsedMs / PERIOD_MS) + 1) * PERIOD_MS;
      lastAttempt = elapsedMs;
      const started = now();
      const entry = { triggers, elapsed_ms: elapsedMs };
      try {
        const data = await takeScreenshot();
        if (!data) {
          record({ kind: 'screenshot_indisponivel', ...entry, reason: 'area_indisponivel',
            duration_ms: Math.round(now() - started) });
          return;
        }
        const image = Buffer.from(data, 'base64');
        if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 ||
            image.at(-2) !== 0xff || image.at(-1) !== 0xd9) throw new Error('jpeg_invalido');
        await mkdir(destination, { recursive: true });
        const name = `${String(++index).padStart(4, '0')}-${String(elapsedMs).padStart(10, '0')}.jpg`;
        await writeFile(path.join(destination, name), image, { flag: 'wx' });
        record({ kind: 'screenshot_salvo', ...entry, file: 'screenshots/' + name, bytes: image.length,
          duration_ms: Math.round(now() - started) });
      } catch (error) {
        disabled = true;
        record({ kind: 'screenshot_indisponivel', ...entry, reason: error.code || error.message,
          disabled: true, duration_ms: Math.round(now() - started) });
      }
    }
  };
}

module.exports = { createScreenshots, screenshotClip };
