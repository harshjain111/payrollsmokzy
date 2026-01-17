export type AppRole = 'owner' | 'accountant' | 'staff' | 'ca';

export type PaymentMode = 'cash' | 'upi' | 'bank_transfer' | 'cheque';

export type VoucherType = 'payment' | 'journal' | 'settlement' | 'advance' | 'deduction';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export type SettlementStatus = 'pending' | 'settled';

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  user_id: string;
  employee_id: string;
  full_name: string;
  email: string;
  phone?: string;
  department?: string;
  designation?: string;
  date_of_joining: string;
  monthly_salary: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface StaffPublic {
  id: string;
  user_id: string;
  employee_id: string;
  full_name: string;
  email: string;
  phone?: string;
  department?: string;
  designation?: string;
  date_of_joining: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  staff_id: string;
  voucher_type: VoucherType;
  voucher_no: string;
  entry_date: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
  tag?: 'salary' | 'advance' | 'deduction' | 'adjustment';
  reference_month?: string;
  payment_mode?: PaymentMode;
  paid_by?: string;
  approved_by?: string;
  is_immutable: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface PaymentRequest {
  id: string;
  staff_id: string;
  requested_by: string;
  amount: number;
  reason: string;
  status: RequestStatus;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
  staff?: StaffPublic;
}

export interface SalarySettlement {
  id: string;
  staff_id: string;
  settlement_month: string;
  base_salary: number;
  leave_days: number;
  leave_deduction: number;
  net_salary: number;
  advances_adjusted: number;
  balance_payable: number;
  status: SettlementStatus;
  settled_at?: string;
  settled_by?: string;
  ledger_entry_id?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  staff?: StaffPublic;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  performed_by?: string;
  performed_at: string;
  ip_address?: string;
}

// Dashboard stats
export interface DashboardStats {
  totalStaff: number;
  activeStaff: number;
  totalPayrollLiability: number;
  advancesOutstanding: number;
  pendingRequests: number;
  monthlySettled: number;
  monthlyPending: number;
}

export interface StaffDashboardData {
  monthlySalary: number;
  totalAdvances: number;
  currentBalance: number;
  pendingRequests: number;
  lastPayment?: LedgerEntry;
  recentEntries: LedgerEntry[];
}
