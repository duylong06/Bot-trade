// core/format.js — định dạng số và giờ, dùng chung cho bot và app.

import { NAMES } from './config.js';

export const coinOf = instId => String(instId).split('-')[0];
// "XAU" → "Vàng XAU", "BTC" → "BTC"
export const labelOf = coin => (NAMES[coin] ? `${NAMES[coin]} ${coin}` : coin);
export const nameOf = coin => NAMES[coin] || null;

export function decimalsOf(tickSz) {
  const s = String(tickSz);
  if (s.includes('e-')) return +s.split('e-')[1];
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.replace(/0+$/, '').length - i - 1;
}

function autoDec(p) {
  const a = Math.abs(p);
  return a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : a >= 0.0001 ? 7 : 9;
}

export function fmtPrice(p, tickSz) {
  if (p == null || !isFinite(p)) return '—';
  const d = Math.min(12, tickSz ? decimalsOf(tickSz) : autoDec(p));
  return Number(p).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtVol(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toFixed(0);
}

export const fmtPct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';

const TZ = 'Asia/Ho_Chi_Minh';
export const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
export const ddmm = ms => new Date(ms).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit' });
export const stamp = ms => `${hhmm(ms)} ${ddmm(ms)}`;
