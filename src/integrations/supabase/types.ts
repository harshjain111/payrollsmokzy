export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          performed_at: string
          performed_by: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          performed_at?: string
          performed_by?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          performed_at?: string
          performed_by?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          description: string
          expense_date: string
          id: string
          ledger_entry_id: string | null
          proof_url: string | null
          reimbursed_at: string | null
          reimbursed_by: string | null
          rejection_reason: string | null
          staff_id: string
          status: Database["public"]["Enums"]["expense_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description: string
          expense_date?: string
          id?: string
          ledger_entry_id?: string | null
          proof_url?: string | null
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          rejection_reason?: string | null
          staff_id: string
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string
          expense_date?: string
          id?: string
          ledger_entry_id?: string | null
          proof_url?: string | null
          reimbursed_at?: string | null
          reimbursed_by?: string | null
          rejection_reason?: string | null
          staff_id?: string
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string | null
          credit: number | null
          debit: number | null
          description: string
          entry_date: string
          id: string
          is_immutable: boolean | null
          paid_by: string | null
          payment_mode: Database["public"]["Enums"]["payment_mode"] | null
          reference_month: string | null
          running_balance: number | null
          staff_id: string
          tag: string | null
          updated_at: string
          voucher_no: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number | null
          debit?: number | null
          description: string
          entry_date?: string
          id?: string
          is_immutable?: boolean | null
          paid_by?: string | null
          payment_mode?: Database["public"]["Enums"]["payment_mode"] | null
          reference_month?: string | null
          running_balance?: number | null
          staff_id: string
          tag?: string | null
          updated_at?: string
          voucher_no: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number | null
          debit?: number | null
          description?: string
          entry_date?: string
          id?: string
          is_immutable?: boolean | null
          paid_by?: string | null
          payment_mode?: Database["public"]["Enums"]["payment_mode"] | null
          reference_month?: string | null
          running_balance?: number | null
          staff_id?: string
          tag?: string | null
          updated_at?: string
          voucher_no?: string
          voucher_type?: Database["public"]["Enums"]["voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          reference_id: string | null
          reference_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          reference_id?: string | null
          reference_type?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          reference_id?: string | null
          reference_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          ledger_entry_id: string | null
          paid_at: string | null
          paid_by: string | null
          reason: string
          rejection_reason: string | null
          requested_by: string
          staff_id: string
          status: Database["public"]["Enums"]["request_status"] | null
          updated_at: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          ledger_entry_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          reason: string
          rejection_reason?: string | null
          requested_by: string
          staff_id: string
          status?: Database["public"]["Enums"]["request_status"] | null
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          ledger_entry_id?: string | null
          paid_at?: string | null
          paid_by?: string | null
          reason?: string
          rejection_reason?: string | null
          requested_by?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["request_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          monthly_salary: number
          staff_id: string
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          monthly_salary: number
          staff_id: string
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          monthly_salary?: number
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_settlements: {
        Row: {
          advances_adjusted: number | null
          balance_payable: number
          base_salary: number
          created_at: string
          created_by: string | null
          id: string
          leave_days: number | null
          leave_deduction: number | null
          ledger_entry_id: string | null
          net_salary: number
          settled_at: string | null
          settled_by: string | null
          settlement_month: string
          staff_id: string
          status: Database["public"]["Enums"]["settlement_status"] | null
          updated_at: string
        }
        Insert: {
          advances_adjusted?: number | null
          balance_payable: number
          base_salary: number
          created_at?: string
          created_by?: string | null
          id?: string
          leave_days?: number | null
          leave_deduction?: number | null
          ledger_entry_id?: string | null
          net_salary: number
          settled_at?: string | null
          settled_by?: string | null
          settlement_month: string
          staff_id: string
          status?: Database["public"]["Enums"]["settlement_status"] | null
          updated_at?: string
        }
        Update: {
          advances_adjusted?: number | null
          balance_payable?: number
          base_salary?: number
          created_at?: string
          created_by?: string | null
          id?: string
          leave_days?: number | null
          leave_deduction?: number | null
          ledger_entry_id?: string | null
          net_salary?: number
          settled_at?: string | null
          settled_by?: string | null
          settlement_month?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["settlement_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_settlements_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_settlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_settlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          created_by: string | null
          date_of_joining: string
          department: string | null
          designation: string | null
          email: string
          employee_id: string
          full_name: string
          id: string
          is_active: boolean | null
          monthly_salary: number
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date_of_joining?: string
          department?: string | null
          designation?: string | null
          email: string
          employee_id: string
          full_name: string
          id?: string
          is_active?: boolean | null
          monthly_salary?: number
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date_of_joining?: string
          department?: string | null
          designation?: string | null
          email?: string
          employee_id?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          monthly_salary?: number
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      staff_public: {
        Row: {
          created_at: string | null
          date_of_joining: string | null
          department: string | null
          designation: string | null
          email: string | null
          employee_id: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          phone: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          date_of_joining?: string | null
          department?: string | null
          designation?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          date_of_joining?: string | null
          department?: string | null
          designation?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_running_balance: {
        Args: { _staff_id: string }
        Returns: {
          entry_id: string
          running_balance: number
        }[]
      }
      can_view_salary: { Args: { _user_id: string }; Returns: boolean }
      create_notification: {
        Args: {
          _message: string
          _reference_id?: string
          _reference_type?: string
          _title: string
          _type?: string
          _user_id: string
        }
        Returns: string
      }
      generate_voucher_no: {
        Args: { _voucher_type: Database["public"]["Enums"]["voucher_type"] }
        Returns: string
      }
      get_advances_outstanding: { Args: { _staff_id: string }; Returns: number }
      get_reconciliation_status: {
        Args: { _month: string; _staff_id: string }
        Returns: Json
      }
      get_staff_salary_for_month: {
        Args: { _month: string; _staff_id: string }
        Returns: number
      }
      get_user_staff_id: { Args: { _user_id: string }; Returns: string }
      get_working_days_in_month: { Args: { _month: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_finance_user: { Args: { _user_id: string }; Returns: boolean }
      is_salary_settled: {
        Args: { _month: string; _staff_id: string }
        Returns: boolean
      }
      validate_settlement: {
        Args: { _month: string; _staff_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "owner" | "accountant" | "staff" | "ca" | "admin"
      expense_category:
        | "travel"
        | "food"
        | "logistics"
        | "equipment"
        | "office_supplies"
        | "communication"
        | "other"
      expense_status:
        | "draft"
        | "pending"
        | "approved"
        | "rejected"
        | "reimbursed"
      payment_mode: "cash" | "upi" | "bank_transfer" | "cheque"
      request_status: "pending" | "approved" | "rejected"
      settlement_status: "pending" | "settled"
      voucher_type:
        | "payment"
        | "journal"
        | "settlement"
        | "advance"
        | "deduction"
        | "expense"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "accountant", "staff", "ca", "admin"],
      expense_category: [
        "travel",
        "food",
        "logistics",
        "equipment",
        "office_supplies",
        "communication",
        "other",
      ],
      expense_status: [
        "draft",
        "pending",
        "approved",
        "rejected",
        "reimbursed",
      ],
      payment_mode: ["cash", "upi", "bank_transfer", "cheque"],
      request_status: ["pending", "approved", "rejected"],
      settlement_status: ["pending", "settled"],
      voucher_type: [
        "payment",
        "journal",
        "settlement",
        "advance",
        "deduction",
        "expense",
      ],
    },
  },
} as const
