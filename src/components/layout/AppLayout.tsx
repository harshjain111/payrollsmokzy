import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  ClipboardList,
  BarChart3,
  Settings,
  LogOut,
  Calculator,
  User,
  Wallet,
  Receipt,
  History,
  UserPlus,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Staff',
    href: '/staff',
    icon: Users,
    roles: ['owner'],
  },
  {
    title: 'Add User',
    href: '/staff/new',
    icon: UserPlus,
    roles: ['owner'],
  },
  {
    title: 'Ledger',
    href: '/ledger',
    icon: FileText,
  },
  {
    title: 'Payments',
    href: '/payments/new',
    icon: CreditCard,
    roles: ['owner', 'admin', 'accountant'],
  },
  {
    title: 'Expenses',
    href: '/expenses',
    icon: Receipt,
  },
  {
    title: 'Requests',
    href: '/requests',
    icon: ClipboardList,
  },
  {
    title: 'Settlements',
    href: '/settlements',
    icon: Calculator,
    roles: ['owner'],
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['owner', 'ca', 'admin', 'accountant'],
  },
  {
    title: 'Audit Log',
    href: '/audit-log',
    icon: History,
    roles: ['owner', 'ca'],
  },
];

function AppSidebar() {
  const { userRole, staffData, signOut, isAccountant, accountingMode, setAccountingMode, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const filteredNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(userRole || '');
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const displayName = staffData?.full_name || user?.email || 'User';
  const roleDisplay = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : '';

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {/* Header */}
      <SidebarHeader className="p-4">
        <div className={cn(
          "flex items-center gap-3 transition-all duration-200",
          isCollapsed && "justify-center"
        )}>
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shrink-0">
            <Wallet className="h-5 w-5 text-white" />
          </div>
          {!isCollapsed && (
            <div className="animate-fade-in">
              <span className="text-xl font-bold text-sidebar-foreground">Smokzy</span>
              <p className="text-xs text-sidebar-muted">Payroll System</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* Accountant mode toggle */}
      {isAccountant && !isCollapsed && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-1 rounded-xl bg-sidebar-accent/30 p-1">
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                'flex-1 text-xs rounded-lg h-9 transition-all',
                !accountingMode 
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg' 
                  : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              )}
              onClick={() => setAccountingMode(false)}
            >
              <User className="mr-1.5 h-3.5 w-3.5" />
              My Account
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                'flex-1 text-xs rounded-lg h-9 transition-all',
                accountingMode 
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg' 
                  : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              )}
              onClick={() => setAccountingMode(true)}
            >
              <Calculator className="mr-1.5 h-3.5 w-3.5" />
              Accounting
            </Button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <SidebarContent className="px-2">
        <SidebarMenu>
          {filteredNavItems.map((item) => {
            const isActive = location.pathname === item.href || 
              (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
            
            return (
              <SidebarMenuItem key={item.href}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "relative transition-all duration-200",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Link to={item.href}>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-amber-400 to-orange-500 rounded-r-full" />
                        )}
                        <div className={cn(
                          'p-1.5 rounded-lg transition-colors',
                          isActive 
                            ? 'bg-gradient-to-br from-amber-400/20 to-orange-500/20' 
                            : 'bg-transparent'
                        )}>
                          <item.icon className={cn(
                            'h-4 w-4',
                            isActive ? 'text-amber-400' : 'text-sidebar-muted'
                          )} />
                        </div>
                        <span className={cn(
                          "transition-opacity",
                          isCollapsed && "opacity-0"
                        )}>
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  {isCollapsed && (
                    <TooltipContent side="right" className="bg-popover text-popover-foreground">
                      {item.title}
                    </TooltipContent>
                  )}
                </Tooltip>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      {/* Footer - User menu */}
      <SidebarFooter className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all hover:bg-sidebar-accent/50 group",
              isCollapsed && "justify-center px-2"
            )}>
              <Avatar className="h-9 w-9 border-2 border-sidebar-accent shrink-0">
                <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-500 text-white text-xs font-medium">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex-1 overflow-hidden animate-fade-in">
                  <p className="truncate text-sm font-medium text-sidebar-foreground">
                    {displayName}
                  </p>
                  <p className="truncate text-xs text-sidebar-muted">
                    {roleDisplay}
                  </p>
                </div>
              )}
              {!isCollapsed && (
                <Settings className="h-4 w-4 text-sidebar-muted group-hover:text-sidebar-foreground transition-colors shrink-0" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56 rounded-xl bg-popover">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-lg">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive rounded-lg">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function AppHeader() {
  const { user, staffData, userRole } = useAuth();
  const location = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const displayName = staffData?.full_name || user?.email || 'User';
  const roleDisplay = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : '';

  const currentNavItem = navItems.find(item => 
    location.pathname === item.href || 
    (item.href !== '/dashboard' && location.pathname.startsWith(item.href))
  );

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-xl px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={toggleSidebar}
        >
          {isCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
        <div className="hidden sm:block">
          <h1 className="text-base font-semibold text-foreground">
            {currentNavItem?.title || 'Dashboard'}
          </h1>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="hidden sm:flex items-center gap-3">
          <div className="h-6 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs font-medium">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs text-muted-foreground">{roleDisplay}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1">
          <AppHeader />
          <main className="flex-1 p-4 sm:p-6 animate-fade-in">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
