import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Clock, CreditCard, FileText, Receipt } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { MobileTabBar } from './MobileTabBar';
import { buildMobileTabs, getMobileTabHrefs, isNavHrefActive } from './mobile-tabs';

// Mirrors hrAllowedPaths in App.tsx (HR routing is deny-by-default).
const HR_ALLOWED = [
  '/dashboard', '/attendance', '/my-attendance', '/requests', '/requests/new',
  '/expenses', '/expenses/new', '/penalties', '/settings', '/users/new',
];

describe('getMobileTabHrefs', () => {
  it('gives each role at most four tabs', () => {
    const cases: Array<[string, boolean, boolean, boolean]> = [
      ['owner', false, false, false],
      ['admin', false, false, false],
      ['accountant', true, true, false],
      ['accountant', true, false, false],
      ['staff', false, false, false],
      ['hr', false, false, true],
      ['hr', false, false, false],
      ['ca', false, false, false],
    ];
    for (const args of cases) {
      const hrefs = getMobileTabHrefs(...args);
      expect(hrefs.length).toBeGreaterThan(0);
      expect(hrefs.length).toBeLessThanOrEqual(4);
      expect(hrefs[0]).toBe('/dashboard');
    }
  });

  it('only gives HR tabs for routes in the HR allow-list', () => {
    for (const workforce of [true, false]) {
      for (const href of getMobileTabHrefs('hr', false, false, workforce)) {
        expect(HR_ALLOWED).toContain(href);
      }
    }
  });

  it('uses the staff tabs for an accountant in personal mode', () => {
    expect(getMobileTabHrefs('accountant', true, false, false)).toEqual(
      getMobileTabHrefs('staff', false, false, false),
    );
  });
});

describe('buildMobileTabs', () => {
  const navItems = [
    { title: 'Dashboard', href: '/dashboard', icon: Clock },
    { title: 'Advance Requests', href: '/requests', icon: FileText, badge: 2 },
    { title: 'Expenses', href: '/expenses', icon: Receipt, badge: 3 },
    { title: 'Payouts', href: '/payouts', icon: CreditCard, badge: 4 },
  ];

  it('drops tabs the sidebar does not offer and keeps badges', () => {
    const { tabs, moreBadge } = buildMobileTabs(navItems, ['/dashboard', '/settlements', '/payouts']);
    expect(tabs.map((t) => t.href)).toEqual(['/dashboard', '/payouts']);
    expect(tabs.map((t) => t.label)).toEqual(['Home', 'Payouts']);
    expect(tabs[1].badge).toBe(4);
    // Badged items only reachable via "More" are summed onto it.
    expect(moreBadge).toBe(5);
  });

  it('keeps labels short', () => {
    const { tabs } = buildMobileTabs(navItems, ['/dashboard', '/requests', '/expenses', '/payouts']);
    for (const tab of tabs) expect(tab.label.length).toBeLessThanOrEqual(10);
  });
});

describe('isNavHrefActive', () => {
  it('matches /dashboard exactly and other routes by prefix', () => {
    expect(isNavHrefActive('/dashboard', '/dashboard')).toBe(true);
    expect(isNavHrefActive('/requests/new', '/requests')).toBe(true);
    expect(isNavHrefActive('/my-attendance', '/attendance')).toBe(false);
  });
});

describe('MobileTabBar', () => {
  function renderBar(path: string) {
    const { tabs, moreBadge } = buildMobileTabs(
      [
        { title: 'Dashboard', href: '/dashboard', icon: Clock },
        { title: 'Payouts', href: '/payouts', icon: CreditCard, badge: 1 },
        { title: 'Expenses', href: '/expenses', icon: Receipt, badge: 2 },
      ],
      ['/dashboard', '/payouts'],
    );
    return render(
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <MobileTabBar tabs={tabs} moreBadge={moreBadge} />
        </SidebarProvider>
      </MemoryRouter>,
    );
  }

  it('renders a Main nav landmark with the active tab marked', () => {
    renderBar('/payouts');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(within(nav).getByRole('link', { name: 'Payouts (1)' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('opens the sidebar drawer from More', () => {
    renderBar('/dashboard');
    const more = screen.getByRole('button', { name: 'More (2)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
  });
});
