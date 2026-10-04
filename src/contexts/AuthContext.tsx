import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AppRole, UserRole, Staff } from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: AppRole | null;
  staffData: Staff | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isOwner: boolean;
  isAdmin: boolean;
  isAccountant: boolean;
  isStaff: boolean;
  isCA: boolean;
  isHR: boolean;
  canCreateUsers: boolean;
  canManageStaff: boolean;
  canAddStaff: boolean;
  canEditStaff: boolean;
  canViewSalaries: boolean;
  canMakePayments: boolean;
  canApproveExpenses: boolean;
  canApproveRequests: boolean;
  canRecordPayments: boolean;
  canRecordSalaryPayments: boolean;
  canRecordAdvancePayments: boolean;
  canRecordExpensePayments: boolean;
  canAccessSettlements: boolean;
  accountingMode: boolean;
  setAccountingMode: (mode: boolean) => void;
  hrWorkforceMode: boolean;
  setHrWorkforceMode: (mode: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<AppRole | null>(null);
  const [staffData, setStaffData] = useState<Staff | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accountingMode, setAccountingMode] = useState(false);
  const [hrWorkforceMode, setHrWorkforceMode] = useState(true);
  const userDataRefreshInFlight = useRef(false);
  const lastUserDataRefreshAt = useRef(0);

  useEffect(() => {
    let initSettled = false;

    // Soft failsafe: if init takes too long, flip the loading flag off so
    // the UI isn't stuck on a spinner — but DO NOT wipe auth tokens.
    // (Wiping tokens here was logging users out on slow networks.)
    const initTimeout = window.setTimeout(() => {
      if (initSettled) return;
      console.warn('Auth initialization slow — releasing loading state without clearing session');
      setIsLoading(false);
    }, 15000);

    const settle = () => {
      initSettled = true;
      window.clearTimeout(initTimeout);
    };

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        settle();
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(() => {
            fetchUserData(session.user.id);
          }, 0);
        } else {
          setUserRole(null);
          setStaffData(null);
          setIsLoading(false);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        settle();
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          fetchUserData(session.user.id);
        } else {
          setIsLoading(false);
        }
      })
      .catch((error) => {
        settle();
        console.error('Error restoring auth session:', error);
        // Do NOT wipe tokens here — a transient network error must not
        // forcibly log the user out. Just stop the spinner.
        setIsLoading(false);
      });

    return () => {
      window.clearTimeout(initTimeout);
      subscription.unsubscribe();
    };
  }, []);


  const fetchUserData = async (userId: string, background = false) => {
    if (background && userDataRefreshInFlight.current) return;
    userDataRefreshInFlight.current = true;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const [roleResult, staffResult] = await Promise.all([
          supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('staff')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
        ]);

        if (roleResult.error || staffResult.error) {
          throw roleResult.error ?? staffResult.error;
        }

        setUserRole(roleResult.data?.role as AppRole ?? null);
        setStaffData(staffResult.data ? staffResult.data as Staff : null);
        lastUserDataRefreshAt.current = Date.now();
        userDataRefreshInFlight.current = false;
        if (!background) setIsLoading(false);
        return;
      } catch (error) {
        console.error('Error in fetchUserData:', error);
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    userDataRefreshInFlight.current = false;
    if (!background) setIsLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;

    const refreshUserData = () => {
      // Returning to a browser tab can fire both `focus` and
      // `visibilitychange`. Refresh quietly and at most once per minute so
      // the current page and any unsaved form input remain mounted.
      if (Date.now() - lastUserDataRefreshAt.current < 60_000) return;
      void fetchUserData(user.id, true);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshUserData();
    };

    window.addEventListener('focus', refreshUserData);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshUserData);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
          },
        },
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAccountingMode(false);
    setHrWorkforceMode(true);
  };

  const isOwner = userRole === 'owner';
  const isAdmin = userRole === 'admin';
  const isAccountant = userRole === 'accountant';
  const isStaff = userRole === 'staff';
  const isCA = userRole === 'ca';
  const isHR = userRole === 'hr';

  // Permission helpers - STRICT SALARY CONFIDENTIALITY
  
  // Staff management - Owner has full access, Admin/Accountant can add/edit non-salary fields
  const canManageStaff = isOwner;
  const canAddStaff = isOwner || isAdmin || isAccountant;
  const canEditStaff = isOwner || isAdmin || isAccountant; // Non-salary fields only for non-owners
  
  // CRITICAL: Only Owner can view salary data
  // Staff can only view their OWN salary (handled at component level)
  // Admin, Accountant, CA cannot view ANY salary data
  const canViewSalaries = isOwner;
  
  // Payment permissions - differentiated by type
  // Owner: full access
  // Admin: can record payments (advance + expense only, no salary)
  // Accountant: can record payments (advance + expense only, no salary)
  const canMakePayments = isOwner;
  const canRecordPayments = isOwner || isAdmin || isAccountant;
  const canRecordSalaryPayments = isOwner; // Only owner can do salary payments/settlements
  const canRecordAdvancePayments = isOwner || isAdmin || isAccountant;
  const canRecordExpensePayments = isOwner || isAdmin || isAccountant;
  
  // Request approval - Owner and Admin only (Accountant cannot approve)
  const canApproveRequests = isOwner || isAdmin;
  
  // Expense approval - Owner and Admin only (Accountant cannot approve)
  const canApproveExpenses = isOwner || isAdmin;
  
  // Settlement access - Owner ONLY
  const canAccessSettlements = isOwner || isAdmin; // Owners and admins settle salaries (paying stays owner-only)
  const canCreateUsers = isOwner || isHR;

  const value = {
    user,
    session,
    userRole,
    staffData,
    isLoading,
    signIn,
    signUp,
    signOut,
    isOwner,
    isAdmin,
    isAccountant,
    isStaff,
    isCA,
    isHR,
    canCreateUsers,
    canManageStaff,
    canAddStaff,
    canEditStaff,
    canViewSalaries,
    canMakePayments,
    canApproveExpenses,
    canApproveRequests,
    canRecordPayments,
    canRecordSalaryPayments,
    canRecordAdvancePayments,
    canRecordExpensePayments,
    canAccessSettlements,
    accountingMode,
    setAccountingMode,
    hrWorkforceMode,
    setHrWorkforceMode,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
