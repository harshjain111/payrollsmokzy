import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { useInstallApp } from '@/hooks/use-install-app';

export function InstallPrompt() {
  const location = useLocation();
  const { canInstall, install, isInstalled, isPromptSnoozed, snoozePrompt } = useInstallApp();

  const handleInstall = async () => {
    const outcome = await install();
    // Declining the browser's install dialog counts as a dismissal.
    if (outcome === 'dismissed') snoozePrompt();
  };

  // Not on the sign-in screen; dismissal snoozes it (see the shared install
  // hook) so it doesn't come back over form buttons on every load.
  if (!canInstall || isInstalled || isPromptSnoozed || location.pathname === '/auth') return null;

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto max-w-sm animate-fade-in">
      <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-elevated">
        <Download className="h-5 w-5 shrink-0 text-primary" />
        <p className="flex-1 text-sm font-medium text-card-foreground">
          Install Smokzy Payroll for a better experience
        </p>
        <Button size="sm" onClick={handleInstall}>
          Install App
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Dismiss install prompt"
          onClick={snoozePrompt}
          className="h-8 w-8 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
