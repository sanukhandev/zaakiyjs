import type { ConsentRecord, ConsentStorage, PurposeDecision } from './types.js';

const MAX_COOKIE_BYTES = 3800;
const MAX_PURPOSES = 100;
const SAFE_ID = /^[a-z][a-z0-9._-]{0,63}$/i;
const REASONS = new Set(['user-grant', 'user-deny', 'user-revoke', 'reject-all', 'preferences', 'policy-change', 'expiry', 'restore', 'hydrate', 'cmp', 'privacy-signal']);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject malformed, prototype-polluting, oversized or unversioned records. */
export function decodeConsentRecord(value: unknown): ConsentRecord | null {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.policyVersion !== 'string' ||
      !value.policyVersion || value.policyVersion.length > 128 || !validTime(value.decidedAt) ||
      !isObject(value.decisions)) return null;
  if (value.policyId !== undefined && (typeof value.policyId !== 'string' || value.policyId.length < 1 || value.policyId.length > 128)) return null;
  if (value.region !== undefined && (typeof value.region !== 'string' || value.region.length > 128)) return null;
  if (value.expiresAt !== undefined && (!validTime(value.expiresAt) || (value.expiresAt as number) < (value.decidedAt as number))) return null;
  const entries = Object.entries(value.decisions);
  if (entries.length > MAX_PURPOSES) return null;
  const decisions: Record<string, PurposeDecision> = Object.create(null) as Record<string, PurposeDecision>;
  for (const [purpose, decision] of entries) {
    if (!SAFE_ID.test(purpose) || !isObject(decision) ||
        !['granted','denied','revoked','expired'].includes(String(decision.status)) ||
        !validTime(decision.updatedAt) ||
        typeof decision.reason !== 'string' || !REASONS.has(decision.reason)) return null;
    decisions[purpose] = {
      status: decision.status as PurposeDecision['status'],
      updatedAt: decision.updatedAt as number,
      reason: decision.reason as PurposeDecision['reason']
    };
  }
  return { schemaVersion: 1, policyVersion: value.policyVersion,
    ...(value.policyId === undefined ? {} : {policyId: value.policyId as string}),
    ...(value.region === undefined ? {} : {region: value.region as string}), decidedAt: value.decidedAt as number,
    ...(value.expiresAt === undefined ? {} : {expiresAt: value.expiresAt as number}), decisions };
}

export function serializeConsentRecord(record: ConsentRecord): string {
  const safe = decodeConsentRecord(record);
  if (!safe) throw new TypeError('Invalid consent record');
  return JSON.stringify(safe);
}

export function createMemoryConsentStorage(initial: ConsentRecord | null = null): ConsentStorage {
  let stored = initial ? decodeConsentRecord(initial) : null;
  return {
    read: () => stored ? decodeConsentRecord(stored) : null,
    write: (record) => { const safe = decodeConsentRecord(record); if (!safe) throw new TypeError('Invalid consent record'); stored = safe; },
    clear: () => { stored = null; }
  };
}

export interface CookieJar { cookie: string }
export interface CookieConsentStorageOptions {
  readonly jar: CookieJar;
  readonly name?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
  readonly maxAgeSeconds?: number;
}
/** Host-only, no third-party domain or unique identifier. Inject a cookie jar; no DOM access on import. */
export function createCookieConsentStorage(options: CookieConsentStorageOptions): ConsentStorage {
  const name = options.name ?? 'zaakiy_consent';
  const path = options.path ?? '/';
  const sameSite = options.sameSite ?? 'Lax';
  if (!SAFE_ID.test(name) || !path.startsWith('/') || /[;\r\n]/.test(path)) throw new TypeError('Invalid cookie configuration');
  if (sameSite === 'None' && !options.secure) throw new TypeError('SameSite=None requires Secure');
  if (options.maxAgeSeconds !== undefined && (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0)) throw new TypeError('Invalid cookie expiry');
  const suffix = `; Path=${path}; SameSite=${sameSite}${options.secure ? '; Secure' : ''}`;
  const read = (): ConsentRecord | null => {
    try {
      const token = options.jar.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(name + '='));
      if (!token) return null;
      const raw = decodeURIComponent(token.slice(name.length + 1));
      if (raw.length > MAX_COOKIE_BYTES) return null;
      return decodeConsentRecord(JSON.parse(raw) as unknown);
    } catch { return null; }
  };
  return {
    read,
    write(record) {
      const payload = encodeURIComponent(serializeConsentRecord(record));
      if (payload.length > MAX_COOKIE_BYTES) throw new RangeError('Consent cookie exceeds safe byte budget');
      try { options.jar.cookie = `${name}=${payload}${suffix}${options.maxAgeSeconds === undefined ? '' : '; Max-Age=' + options.maxAgeSeconds}`; }
      catch { /* Cookies can be blocked: keep in-memory consent effective. */ }
    },
    clear() { try { options.jar.cookie = `${name}=; Max-Age=0${suffix}`; } catch { /* blocked cookies */ } }
  };
}

/** The host app injects authenticated, request-scoped server-session read/write operations. */
export function createServerSessionConsentStorage(adapter: ConsentStorage): ConsentStorage {
  return { read: () => adapter.read(), write: r => adapter.write(r), clear: () => adapter.clear?.() };
}
