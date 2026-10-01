-- Ported from drizzle/migrations/0000_add_hr_app_role.sql (originally applied by Lovable's Drizzle runner).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr';
