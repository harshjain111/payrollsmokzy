import { useAuth } from '@/contexts/AuthContext';
import { OwnerDashboard } from '@/components/dashboards/OwnerDashboard';
import { AdminDashboard } from '@/components/dashboards/AdminDashboard';
import { AccountantDashboard } from '@/components/dashboards/AccountantDashboard';
import { StaffDashboard } from '@/components/dashboards/StaffDashboard';
import { CADashboard } from '@/components/dashboards/CADashboard';
import { HRDashboard } from '@/components/dashboards/HRDashboard';
import { Loader2 } from 'lucide-react';

export default function Dashboard() {
  const { userRole, isLoading, isAccountant, accountingMode, isHR, hrWorkforceMode, staffData } = useAuth();

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
    return staffData ? <StaffDashboard /> : (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h2 className="text-xl font-semibold">Staff profile not linked</h2>
        <p className="mt-2 text-sm text-muted-foreground">Ask the Owner to link this HR login to an active staff record to use personal attendance and requests.</p>
      </div>
    );
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
      return (
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold text-foreground">Role Not Assigned</h2>
          <p className="text-muted-foreground mt-2">
            Please contact your administrator to assign your role.
          </p>
        </div>
      );
  }
}
