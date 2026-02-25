import React, { createContext, useContext, useEffect, useState } from 'react';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<AppRole | null>(null);
  const [staffData, setStaffData] = useState<Staff | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accountingMode, setAccountingMode] = useState(false);

  useEffect(() => {
    let initTimedOut = false;

    // Hard timeout: if auth init takes > 8s, force to login screen
    const initTimeout = window.setTimeout(() => {
      initTimedOut = true;
      console.warn('Auth initialization timed out — clearing stale session');
      // Clear any stale supabase auth tokens
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch (_) { /* ignore */ }
      setSession(null);
      setUser(null);
      setUserRole(null);
      setStaffData(null);
      setIsLoading(false);
    }, 8000);

    const clearInitTimeout = () => window.clearTimeout(initTimeout);

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (initTimedOut) return; // ignore late callbacks
        clearInitTimeout();
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
        if (initTimedOut) return;
        clearInitTimeout();
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          fetchUserData(session.user.id);
        } else {
          setIsLoading(false);
        }
      })
      .catch((error) => {
        if (initTimedOut) return;
        clearInitTimeout();
        console.error('Error restoring auth session:', error);
        // Clear stale tokens on session restore failure
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (_) { /* ignore */ }
        setSession(null);
        setUser(null);
        setUserRole(null);
        setStaffData(null);
        setIsLoading(false);
      });

    return () => {
      clearInitTimeout();
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserData = async (userId: string) => {
    try {
      // Fetch user role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (roleError && roleError.code !== 'PGRST116') {
        console.error('Error fetching role:', roleError);
      }

      if (roleData) {
        setUserRole(roleData.role as AppRole);
      }

      // Fetch staff data
      const { data: staffDataResult, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (staffError && staffError.code !== 'PGRST116') {
        console.error('Error fetching staff data:', staffError);
      }

      if (staffDataResult) {
        setStaffData(staffDataResult as Staff);
      }
    } catch (error) {
      console.error('Error in fetchUserData:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
  };

  const isOwner = userRole === 'owner';
  const isAdmin = userRole === 'admin';
  const isAccountant = userRole === 'accountant';
  const isStaff = userRole === 'staff';
  const isCA = userRole === 'ca';

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
  const canAccessSettlements = isOwner;

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
