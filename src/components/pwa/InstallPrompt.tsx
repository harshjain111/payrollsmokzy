import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { useInstallApp } from '@/hooks/use-install-app';

export function InstallPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const { canInstall, install, isInstalled } = useInstallApp();

  const handleInstall = async () => {
    await install();
  };

  if (!canInstall || isInstalled || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm animate-fade-in">
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
          onClick={() => setDismissed(true)}
          className="h-8 w-8 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
