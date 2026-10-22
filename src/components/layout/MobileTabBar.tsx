import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/ui/sidebar';
import { isNavHrefActive, type MobileTab } from './mobile-tabs';

/** Height of the bar's tab row, excluding the iPhone home-indicator inset. */
const MOBILE_TAB_BAR_HEIGHT = '3.5rem';

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

const tabClass =
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight outline-none transition-colors focus-visible:bg-accent/60';

/**
 * Phone-only (below md) bottom navigation: the role's most used pages plus a
 * "More" tab that opens the existing sidebar drawer.
 */
export function MobileTabBar({ tabs, moreBadge }: { tabs: MobileTab[]; moreBadge: number }) {
  const location = useLocation();
  const { setOpenMobile, openMobile } = useSidebar();

  return (
    <>
      {/* Lets other fixed bottom UI (e.g. the install prompt) sit above the bar
          on phones; removed automatically when the layout unmounts. */}
      <style>{`@media (max-width: 767px) { :root { --mobile-tab-bar-height: ${MOBILE_TAB_BAR_HEIGHT}; } }`}</style>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <ul className="flex items-stretch">
          {tabs.map((tab) => {
            const active = isNavHrefActive(location.pathname, tab.href);
            const Icon = tab.icon;
            return (
              <li key={tab.href} className="flex min-w-0 flex-1">
                <Link
                  to={tab.href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={tab.badge > 0 ? `${tab.label} (${tab.badge})` : undefined}
                  className={cn(tabClass, active ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
                >
                  <span className="relative">
                    <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} aria-hidden="true" />
                    <TabBadge count={tab.badge} />
                  </span>
                  <span className="max-w-full truncate">{tab.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setOpenMobile(true)}
              aria-haspopup="dialog"
              aria-expanded={openMobile}
              aria-label={moreBadge > 0 ? `More (${moreBadge})` : 'More'}
              className={cn(tabClass, 'text-muted-foreground hover:text-foreground')}
            >
              <span className="relative">
                <Menu className="h-5 w-5" aria-hidden="true" />
                <TabBadge count={moreBadge} />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
