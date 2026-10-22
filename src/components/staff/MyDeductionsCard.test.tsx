import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { MyDeductionsCard } from './MyDeductionsCard';

const mocks = vi.hoisted(() => ({
  fetchMyDeductions: vi.fn(),
  fetchTodayLateFine: vi.fn(),
}));

vi.mock('@/lib/deductions', () => ({
  fetchMyDeductions: mocks.fetchMyDeductions,
  fetchTodayLateFine: mocks.fetchTodayLateFine,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ staffData: { id: 's1' } }) }));

const renderCard = () =>
  render(
    <LanguageProvider>
      <MemoryRouter>
        <MyDeductionsCard />
      </MemoryRouter>
    </LanguageProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchTodayLateFine.mockResolvedValue(null);
});

describe('MyDeductionsCard', () => {
  it('praises a clean month', async () => {
    mocks.fetchMyDeductions.mockResolvedValue({ month: '2026-10', daily_rate: 500, total: 0, items: [] });
    renderCard();
    expect(await screen.findByText('Great going, keep it up! No salary cut so far.')).toBeInTheDocument();
    expect(screen.getByText('₹0')).toBeInTheDocument();
  });

  it('lists each cut, leaves waived ones out of the total, and asks to improve', async () => {
    mocks.fetchMyDeductions.mockResolvedValue({
      month: '2026-10',
      daily_rate: 500,
      total: 1050,
      items: [
        { id: 'a', date: '2026-10-20', kind: 'absent', days: 2, amount: 1000, reason: 'Absent — no check-in', waived: false },
        { id: 'b', date: '2026-10-18', kind: 'late', late_minutes: 20, amount: 50, waived: false },
        { id: 'c', date: '2026-10-10', kind: 'absent', days: 1, amount: 500, waived: true, waive_reason: 'On approved leave' },
      ],
    });
    mocks.fetchTodayLateFine.mockResolvedValue({
      id: 'today-x', date: '2026-10-22', kind: 'late', late_minutes: 35, amount: 100, waived: false, provisional: true,
    });
    renderCard();
    expect(await screen.findByText('Please improve to avoid further deductions.')).toBeInTheDocument();
    // 1000 + 50 + today's 100; the waived 500 does not count.
    expect(screen.getByText('₹1,150')).toBeInTheDocument();
    expect(screen.getByText('Absent without informing · 2 days')).toBeInTheDocument();
    expect(screen.getByText('Late 20 min')).toBeInTheDocument();
    expect(screen.getByText('Today · final at check-out')).toBeInTheDocument();
    expect(screen.getByText(/Waived \(On approved leave\)/)).toBeInTheDocument();
  });
});
