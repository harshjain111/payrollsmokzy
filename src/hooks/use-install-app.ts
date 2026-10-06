import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyListeners();
  });
}

// Dismissing the global install prompt snoozes it (Settings' Install button
// keeps working regardless).
const PROMPT_SNOOZE_KEY = "smokzy.installPromptSnoozedUntil";
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// In-memory fallback so a snooze still holds this session if storage throws.
let memorySnoozedUntil = 0;

const readSnoozedUntil = () => {
  try {
    const value = Number(window.localStorage.getItem(PROMPT_SNOOZE_KEY));
    return Math.max(memorySnoozedUntil, Number.isFinite(value) ? value : 0);
  } catch {
    return memorySnoozedUntil;
  }
};

const isStandalone = () => {
  if (typeof window === "undefined") return false;

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
};

export function useInstallApp() {
  const [installPrompt, setInstallPrompt] = useState(deferredPrompt);
  const [isInstalled, setIsInstalled] = useState(isStandalone);
  const [snoozedUntil, setSnoozedUntil] = useState(() => (typeof window === "undefined" ? 0 : readSnoozedUntil()));

  useEffect(() => {
    const syncState = () => {
      setInstallPrompt(deferredPrompt);
      setIsInstalled(isStandalone());
      setSnoozedUntil(readSnoozedUntil());
    };

    listeners.add(syncState);
    syncState();
    return () => {
      listeners.delete(syncState);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return "unavailable" as const;

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      deferredPrompt = null;
      setInstallPrompt(null);
    }
    return outcome;
  };

  /** Hide the global install prompt for a week (persisted when storage works). */
  const snoozePrompt = () => {
    const until = Date.now() + PROMPT_SNOOZE_MS;
    memorySnoozedUntil = until;
    try {
      window.localStorage.setItem(PROMPT_SNOOZE_KEY, String(until));
    } catch {
      // Storage unavailable — the snooze still applies until reload.
    }
    setSnoozedUntil(until);
    notifyListeners();
  };

  return {
    canInstall: Boolean(installPrompt),
    install,
    isInstalled,
    /** Whether the global (non-Settings) install prompt should currently show. */
    isPromptSnoozed: snoozedUntil > Date.now(),
    snoozePrompt,
    isIOS: typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent),
  };
}