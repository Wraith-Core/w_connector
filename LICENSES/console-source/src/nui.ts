/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · nui.ts
 * The page's calls into Lua (or into the browser stand-in, dev/mock.ts):
 *   post(name, data)            → Result<T>   (fetch https://w_admin/<name>, 45 s timeout)
 *   useLuaMessage(action, fn)   subscribe to one SendNUIMessage action inside a page
 * Every callback answers { ok, error?, errorKey?, message?, data? } (types.ts Result).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Result } from './types';

declare function GetParentResourceName(): string;

const resource = (): string => {
  try {
    return typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'w_connector';
  } catch {
    return 'w_connector';
  }
};

interface MockHost { callback?: (name: string, data: unknown) => unknown }
type Capabilities = { actions: string[]; unavailable?: Record<string, string>; game?: string };
let capabilities: Capabilities | null = null;
const listeners = new Set<() => void>();
window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { action?: string; data?: { connector?: Capabilities } & Capabilities } | null;
  if (m?.action === 'open') capabilities = m.data?.connector ?? null;
  else if (m?.action === 'connectorCapabilities') capabilities = m.data ?? null;
  else return;
  for (const fn of listeners) fn();
});
export function useConsoleCapabilities() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => capabilities);
}
export function actionAvailable(name: string): boolean { return capabilities === null || capabilities.actions.includes(name); }
export function actionReason(name: string): string {
  const ar = document.documentElement.lang !== 'en';
  if (capabilities?.unavailable?.[name] === 'native_permission') return ar
    ? 'تحتاج إلى صلاحية هذه الأداة في إضافة السيرفر أيضًا.' : 'This tool also requires permission in the server integration.';
  return capabilities?.unavailable?.[name]
    ? (ar ? 'تحتاج هذه الأداة إلى إضافة متوافقة ومشغّلة على السيرفر.' : 'This tool needs a compatible, running server integration.')
    : (ar ? 'لا تملك صلاحية هذا الإجراء.' : 'You do not have permission for this action.');
}

/** True only inside the browser stand-in, so the page can show its dev hints */
export const isMock = (): boolean => !!(window as unknown as { __waMock?: MockHost }).__waMock;

export async function post<T = unknown>(name: string, data: unknown = {}): Promise<Result<T>> {
  const d = (data && typeof data === 'object' ? data : {}) as { action?: string; args?: { state?: boolean } };
  const domains = ['player', 'self', 'server', 'hud', 'characters', 'scripts', 'settings', 'news', 'reports', 'ranks', 'bans', 'map'];
  const canonical = d.action && domains.includes(name) && !(name === 'map' && d.action === 'stopPlayers')
    ? `${name}.${d.action}` : name === 'citizen' ? 'citizen.lookup' : name === 'logs' ? 'logs.query' : null;
  const safeOff = name === 'self' && d.args?.state === false;
  if (canonical && !safeOff && capabilities && !actionAvailable(canonical)) return { ok: false, error: actionReason(canonical) };
  const mock = (window as unknown as { __waMock?: MockHost }).__waMock;
  if (mock?.callback) {
    try {
      const r = (await mock.callback(name, data)) as Result<T> | null;
      return r ?? { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`https://${resource()}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: 'ui_net_error' };
    const body = (await res.json()) as Result<T> | null;
    if (!body || typeof body.ok !== 'boolean') return { ok: false, error: 'ui_net_error' };
    return body;
  } catch {
    return { ok: false, error: 'ui_net_error' };
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Calls fn(data) for every SendNUIMessage({ action, data }) with this action while mounted */
export function useLuaMessage<T = unknown>(action: string, fn: (data: T) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { action?: string; data?: unknown } | null;
      if (m && m.action === action) ref.current((m.data ?? {}) as T);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [action]);
}
