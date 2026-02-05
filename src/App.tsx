import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AppLayout } from "@/components/layout/AppLayout";

// Pages
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import StaffList from "./pages/StaffList";
import StaffForm from "./pages/StaffForm";
import StaffDetails from "./pages/StaffDetails";
import UsersList from "./pages/UsersList";
import UserForm from "./pages/UserForm";
import Ledger from "./pages/Ledger";
import Requests from "./pages/Requests";
import NewRequest from "./pages/NewRequest";
import Expenses from "./pages/Expenses";
import NewExpense from "./pages/NewExpense";
import Settlements from "./pages/Settlements";
import SalariesAdvances from "./pages/SalariesAdvances";
import Payouts from "./pages/Payouts";
import Reports from "./pages/Reports";
import AuditLog from "./pages/AuditLog";
import Settings from "./pages/Settings";
import LeaveRecords from "./pages/LeaveRecords";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

// App routes
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/auth" element={<Auth />} />
      
      {/* Protected Routes */}
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/staff" element={<ProtectedRoute><StaffList /></ProtectedRoute>} />
      <Route path="/staff/new" element={<ProtectedRoute><StaffForm /></ProtectedRoute>} />
      <Route path="/staff/:id" element={<ProtectedRoute><StaffDetails /></ProtectedRoute>} />
      <Route path="/staff/:id/edit" element={<ProtectedRoute><StaffForm /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><UsersList /></ProtectedRoute>} />
      <Route path="/users/new" element={<ProtectedRoute><UserForm /></ProtectedRoute>} />
      <Route path="/users/:id/edit" element={<ProtectedRoute><UserForm /></ProtectedRoute>} />
      <Route path="/ledger" element={<ProtectedRoute><Ledger /></ProtectedRoute>} />
      <Route path="/requests" element={<ProtectedRoute><Requests /></ProtectedRoute>} />
      <Route path="/requests/new" element={<ProtectedRoute><NewRequest /></ProtectedRoute>} />
      <Route path="/expenses" element={<ProtectedRoute><Expenses /></ProtectedRoute>} />
      <Route path="/expenses/new" element={<ProtectedRoute><NewExpense /></ProtectedRoute>} />
      <Route path="/payouts" element={<ProtectedRoute><Payouts /></ProtectedRoute>} />
      <Route path="/settlements" element={<ProtectedRoute><Settlements /></ProtectedRoute>} />
      <Route path="/leave-records" element={<ProtectedRoute><LeaveRecords /></ProtectedRoute>} />
      <Route path="/salaries-advances" element={<ProtectedRoute><SalariesAdvances /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/audit-log" element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      
      {/* Catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
