import { useAuth } from '@/contexts/AuthContext';
import { OwnerDashboard } from '@/components/dashboards/OwnerDashboard';
import { AdminDashboard } from '@/components/dashboards/AdminDashboard';
import { AccountantDashboard } from '@/components/dashboards/AccountantDashboard';
import { StaffDashboard, StaffProfileNotLinked } from '@/components/dashboards/StaffDashboard';
import { CADashboard } from '@/components/dashboards/CADashboard';
import { HRDashboard } from '@/components/dashboards/HRDashboard';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useState } from 'react';

/** Phone logins are stored as <phone>@phone.smokzy.internal; show just the phone number. */
const loginLabel = (email?: string | null) => (email ? email.replace(/@phone\.smokzy\.internal$/, '') : 'this login');

export default function Dashboard() {
  const { user, userRole, isLoading, isAccountant, accountingMode, isHR, hrWorkforceMode, staffData, userDataError, retryUserData, signOut } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await retryUserData();
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Accountant in personal mode sees staff dashboard
  if (isAccountant && !accountingMode) {
    return <StaffDashboard />;
  }

  if (isHR && !hrWorkforceMode) {
    return staffData ? <StaffDashboard /> : <StaffProfileNotLinked roleLabel="HR login" />;
  }

  switch (userRole) {
    case 'owner':
      return <OwnerDashboard />;
    case 'admin':
      return <AdminDashboard />;
    case 'accountant':
      return <AccountantDashboard />;
    case 'staff':
      return <StaffDashboard />;
    case 'ca':
      return <CADashboard />;
    case 'hr':
      return <HRDashboard />;
    default:
      // Loading the role failed (network) — don't show it as a permission problem.
      if (userDataError) {
        return (
          <div className="mx-auto max-w-lg py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <WifiOff className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Couldn't load your account</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Check your internet and tap Retry.
            </p>
            <Button className="mt-6" onClick={handleRetry} disabled={isRetrying}>
              {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Retry
            </Button>
          </div>
        );
      }
      // The server confirmed this login has no role (a failed load shows the screen above).
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <h2 className="text-xl font-semibold text-foreground">Role Not Assigned</h2>
          <p className="mt-2 text-muted-foreground">
            This login has no role yet. Ask the owner to open Users and give a role to{' '}
            <span className="font-medium text-foreground">{loginLabel(user?.email)}</span>.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={handleRetry} disabled={isRetrying}>
              {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Retry
            </Button>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      );
  }
}
