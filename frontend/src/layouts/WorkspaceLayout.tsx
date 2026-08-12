import {
  BarChart3, Bell, Boxes, Building2, CircleDollarSign, ClipboardCheck, FileCheck2,
  FileText, FolderKanban, HelpCircle, Home, LayoutDashboard, LogOut,
  Menu, MessageSquare, Megaphone, Package, PanelLeftClose, Search, Settings,
  ShieldCheck, ShoppingBag, Store, Truck, UserRoundCheck, UsersRound, WalletCards, X,
} from 'lucide-react';
import { useState, type ComponentType, type SVGProps } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useAuth } from '../contexts/AuthContext';
import { initials, titleFromSlug } from '../lib/format';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type NavItem = { label: string; to: string; icon: Icon };

const sellerNav: NavItem[] = [
  { label: 'Overview', to: '/seller/dashboard', icon: LayoutDashboard },
  { label: 'Storefront', to: '/seller/store', icon: Store },
  { label: 'Products', to: '/seller/products', icon: Boxes },
  { label: 'Inventory', to: '/seller/inventory', icon: Package },
  { label: 'Orders', to: '/seller/orders', icon: ShoppingBag },
  { label: 'Customers', to: '/seller/customers', icon: UsersRound },
  { label: 'Messages', to: '/seller/messages', icon: MessageSquare },
  { label: 'Analytics', to: '/seller/analytics', icon: BarChart3 },
  { label: 'Finance', to: '/seller/finance', icon: CircleDollarSign },
  { label: 'Payouts', to: '/seller/payouts', icon: WalletCards },
  { label: 'Advertising', to: '/seller/advertising', icon: Megaphone },
  { label: 'Sourcing', to: '/seller/sourcing', icon: Truck },
  { label: 'Team', to: '/seller/team', icon: UserRoundCheck },
  { label: 'Settings', to: '/seller/settings', icon: Settings },
];

const supplierNav: NavItem[] = [
  { label: 'Overview', to: '/supplier/dashboard', icon: LayoutDashboard },
  { label: 'Profile', to: '/supplier/profile', icon: Building2 },
  { label: 'Catalog', to: '/supplier/catalog', icon: Boxes },
  { label: 'Requests', to: '/supplier/requests', icon: FileText },
  { label: 'Orders', to: '/supplier/orders', icon: Package },
  { label: 'Messages', to: '/supplier/messages', icon: MessageSquare },
  { label: 'Analytics', to: '/supplier/analytics', icon: BarChart3 },
  { label: 'Verification', to: '/supplier/verification', icon: ShieldCheck },
  { label: 'Settings', to: '/supplier/settings', icon: Settings },
];

const adminNav: NavItem[] = [
  { label: 'Overview', to: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Users', to: '/admin/users', icon: UsersRound },
  { label: 'Sellers', to: '/admin/sellers', icon: Store },
  { label: 'Suppliers', to: '/admin/suppliers', icon: Building2 },
  { label: 'Products', to: '/admin/products', icon: Boxes },
  { label: 'Orders', to: '/admin/orders', icon: ShoppingBag },
  { label: 'Payments', to: '/admin/payments', icon: WalletCards },
  { label: 'Finance', to: '/admin/finance', icon: CircleDollarSign },
  { label: 'Disputes', to: '/admin/disputes', icon: ClipboardCheck },
  { label: 'Verification', to: '/admin/kyc', icon: FileCheck2 },
  { label: 'Sourcing', to: '/admin/sourcing', icon: Truck },
  { label: 'Advertising', to: '/admin/advertising', icon: Megaphone },
  { label: 'Broadcasts', to: '/admin/broadcasts', icon: MessageSquare },
  { label: 'Analytics', to: '/admin/analytics', icon: BarChart3 },
  { label: 'Audit logs', to: '/admin/audit-logs', icon: FolderKanban },
  { label: 'Settings', to: '/admin/settings', icon: Settings },
];

const workspaceConfig = {
  seller: { label: 'Seller centre', nav: sellerNav },
  supplier: { label: 'Supplier portal', nav: supplierNav },
  admin: { label: 'Control room', nav: adminNav },
};

export function WorkspaceLayout({ kind }: { kind: keyof typeof workspaceConfig }) {
  const config = workspaceConfig[kind];
  const { pathname } = useLocation();
  const { viewer, authUser, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const currentTitle = config.nav.find((item) => pathname.startsWith(item.to))?.label ?? titleFromSlug(pathname.split('/').pop() ?? 'Dashboard');
  const displayName = viewer?.displayName ?? authUser?.email?.split('@')[0] ?? 'Account';

  return (
    <div className={`workspace workspace--${kind}${collapsed ? ' workspace--collapsed' : ''}`}>
      <aside className={`workspace-sidebar${drawerOpen ? ' is-open' : ''}`}>
        <div className="workspace-sidebar__head">
          <Brand inverse />
          <button className="icon-button icon-button--inverse workspace-sidebar__mobile-close" onClick={() => setDrawerOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <span className="workspace-sidebar__label">{config.label}</span>
        <nav className="workspace-nav" aria-label={`${config.label} navigation`} onClick={() => setDrawerOpen(false)}>
          {config.nav.map(({ label, to, icon: ItemIcon }) => <NavLink key={to} to={to} title={collapsed ? label : undefined}><ItemIcon aria-hidden="true" /><span>{label}</span></NavLink>)}
        </nav>
        <div className="workspace-sidebar__foot">
          <Link to="/help"><HelpCircle /><span>Help centre</span></Link>
          <Link to="/"><Home /><span>Marketplace</span></Link>
          <button onClick={() => void signOut()}><LogOut /><span>Sign out</span></button>
        </div>
      </aside>
      {drawerOpen && <button className="workspace-backdrop" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />}
      <section className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar__start">
            <button className="icon-button workspace-topbar__mobile-menu" onClick={() => setDrawerOpen(true)} aria-label="Open navigation"><Menu /></button>
            <button className="icon-button workspace-topbar__collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}><PanelLeftClose /></button>
            <div><span>{config.label}</span><h1>{currentTitle}</h1></div>
          </div>
          <div className="workspace-topbar__actions">
            <label className="workspace-search"><Search /><span className="sr-only">Search workspace</span><input placeholder="Search" /></label>
            <button className="icon-button" aria-label="Notifications"><Bell /></button>
            <Link className="profile-chip" to="/account"><span>{initials(displayName)}</span><div><strong>{displayName}</strong><small>{kind === 'admin' ? 'Platform admin' : kind}</small></div></Link>
          </div>
        </header>
        <main id="main-content" className="workspace-content"><Outlet /></main>
      </section>
    </div>
  );
}
