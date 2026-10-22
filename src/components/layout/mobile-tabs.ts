import type { ElementType } from 'react';
import { Home } from 'lucide-react';

/** A sidebar entry, as produced by AppLayout's getNavSections. */
export interface TabSourceItem {
  title: string;
  href: string;
  icon: ElementType;
  badge?: number;
}

export interface MobileTab {
  href: string;
  label: string;
  icon: ElementType;
  badge: number;
}

/** Short (<= 10 chars) labels that fit a phone-width tab. */
const SHORT_LABELS: Record<string, string> = {
  '/dashboard': 'Home',
  '/attendance': 'Attendance',
  '/my-attendance': 'Attendance',
  '/settlements': 'Salary',
  '/payouts': 'Payouts',
  '/ledger': 'Ledger',
  '/reports': 'Reports',
  '/requests': 'Advance',
  '/expenses': 'Expenses',
  '/penalties': 'Penalties',
};

const PERSONAL_TABS = ['/dashboard', '/my-attendance', '/requests', '/expenses'];

/**
 * The (up to) four most used pages per role/mode. Every href here must also be
 * in that role's sidebar; buildMobileTabs drops any that are not, so a tab can
 * never point HR (deny-by-default routing) at a page the sidebar hides.
 */
export function getMobileTabHrefs(
  userRole: string | null,
  isAccountant: boolean,
  accountingMode: boolean,
  hrWorkforceMode: boolean,
): string[] {
  if (userRole === 'owner' || userRole === 'admin') {
    return ['/dashboard', '/attendance', '/settlements', '/payouts'];
  }
  if (isAccountant) {
    return accountingMode ? ['/dashboard', '/payouts', '/ledger', '/reports'] : PERSONAL_TABS;
  }
  if (userRole === 'staff') return PERSONAL_TABS;
  if (userRole === 'hr') {
    return hrWorkforceMode
      ? ['/dashboard', '/attendance', '/penalties']
      : ['/dashboard', '/my-attendance', '/expenses', '/requests'];
  }
  if (userRole === 'ca') return ['/dashboard', '/ledger', '/attendance', '/reports'];
  return [];
}

/** Same rule as the sidebar: exact for /dashboard, prefix for the rest. */
export function isNavHrefActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
}

/**
 * Picks the tab entries from the role's sidebar items, keeping their badges.
 * moreBadge totals badges of items only reachable through "More", so pending
 * work hidden in the drawer is still signalled.
 */
export function buildMobileTabs(
  navItems: TabSourceItem[],
  tabHrefs: string[],
): { tabs: MobileTab[]; moreBadge: number } {
  const byHref = new Map(navItems.map((item) => [item.href, item]));
  const tabs: MobileTab[] = [];
  for (const href of tabHrefs) {
    const item = byHref.get(href);
    if (!item) continue;
    tabs.push({
      href,
      label: SHORT_LABELS[href] ?? item.title,
      icon: href === '/dashboard' ? Home : item.icon,
      badge: item.badge ?? 0,
    });
  }
  const shown = new Set(tabs.map((t) => t.href));
  const moreBadge = navItems
    .filter((item) => !shown.has(item.href))
    .reduce((sum, item) => sum + (item.badge ?? 0), 0);
  return { tabs, moreBadge };
}
