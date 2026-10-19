import { supabase } from '@/integrations/supabase/client';

/**
 * Web Push for owner check-in/check-out alerts.
 * The service worker shows the notifications (public/push-sw.js); the notify-attendance edge
 * function sends them to every phone saved in push_subscriptions.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushStatus = 'unsupported' | 'needs-install' | 'denied' | 'on' | 'off';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  // The service worker only exists in the built app; give it a moment to register.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!VAPID_PUBLIC_KEY || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (!('PushManager' in window)) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Ask permission, subscribe this phone and save it for the signed-in user. */
export async function enablePush(userId: string): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  if (!reg) throw new Error('The app is still loading. Please try again in a few seconds.');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from('push_subscriptions' as never).upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    } as never,
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
  return 'on';
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions' as never).delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush(): Promise<number> {
  const { data, error } = await supabase.functions.invoke('notify-attendance', { body: { test: true } });
  if (error) throw error;
  return (data as { sent?: number })?.sent ?? 0;
}
