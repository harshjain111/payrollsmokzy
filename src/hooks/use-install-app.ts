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

const isStandalone = () => {
  if (typeof window === "undefined") return false;

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
};

export function useInstallApp() {
  const [installPrompt, setInstallPrompt] = useState(deferredPrompt);
  const [isInstalled, setIsInstalled] = useState(isStandalone);

  useEffect(() => {
    const syncState = () => {
      setInstallPrompt(deferredPrompt);
      setIsInstalled(isStandalone());
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

  return {
    canInstall: Boolean(installPrompt),
    install,
    isInstalled,
    isIOS: typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent),
  };
}