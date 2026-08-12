import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ShieldX } from 'lucide-react';
import { lazy, Suspense, type PropsWithChildren } from 'react';
import { Link, Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { PageLoader } from './components/States';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import { ToastProvider } from './contexts/ToastContext';
import { MarketplaceLayout } from './layouts/MarketplaceLayout';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';
import { demoMode } from './lib/api';

const AuthCallbackPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.AuthCallbackPage })));
const AuthPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.AuthPage })));
const SignupChoicePage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.SignupChoicePage })));

const AccountPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.AccountPage })));
const BuyerCollectionPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.BuyerCollectionPage })));
const CartPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.CartPage })));
const CatalogPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.CatalogPage })));
const CheckoutPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.CheckoutPage })));
const CheckoutSuccessPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.CheckoutSuccessPage })));
const ConversationPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.ConversationPage })));
const HelpArticlePage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.HelpArticlePage })));
const HomePage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.HomePage })));
const InfoPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.InfoPage })));
const NotFoundPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.NotFoundPage })));
const OrderDetailPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.OrderDetailPage })));
const OrdersPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.OrdersPage })));
const ProductPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.ProductPage })));
const RfqPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.RfqPage })));
const ServiceDetailPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.ServiceDetailPage })));
const ServicesPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.ServicesPage })));
const SourcingPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.SourcingPage })));
const StorePage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.StorePage })));
const UpcomingPage = lazy(() => import('./pages/MarketplacePages').then((module) => ({ default: module.UpcomingPage })));

const AdminBroadcastEditorPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.AdminBroadcastEditorPage })));
const AdminListPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.AdminListPage })));
const DashboardPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.DashboardPage })));
const FinancePage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.FinancePage })));
const ProductEditorPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.ProductEditorPage })));
const SellerOnboardingPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.SellerOnboardingPage })));
const SellerSourcingEditorPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.SellerSourcingEditorPage })));
const SellerStorePage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.SellerStorePage })));
const WorkspaceDetailPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.WorkspaceDetailPage })));
const WorkspaceListPage = lazy(() => import('./pages/WorkspacePages').then((module) => ({ default: module.WorkspaceListPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error: any) => error?.status >= 400 && error?.status < 500 ? false : failureCount < 2,
    },
    mutations: { retry: false },
  },
});

function Providers({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}><AuthProvider><ToastProvider><CartProvider>{children}</CartProvider></ToastProvider></AuthProvider></QueryClientProvider>;
}

function RequireAuth() {
  const { authUser, loading } = useAuth();
  if (loading) return <main id="main-content" className="route-state"><PageLoader label="Checking your session" /></main>;
  if (!authUser) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { viewer, loading } = useAuth();
  if (loading) return <main id="main-content" className="route-state"><PageLoader label="Checking your access" /></main>;
  const roles = viewer?.platformRoles ?? [];
  const allowed = demoMode || roles.some((role) => ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'SOURCING_MANAGER'].includes(role));
  return allowed ? <Outlet /> : <AccessDenied />;
}

function AccessDenied() {
  return <main id="main-content" className="access-denied"><span><ShieldX /></span><h1>This workspace isn’t available to your account.</h1><p>If you believe your access should have changed, sign in again or ask an account administrator.</p><Link className="button button--primary" to="/account">Return to your account <ArrowRight /></Link></main>;
}

function RouteError() {
  return <main id="main-content" className="access-denied"><span><AlertTriangle /></span><h1>That page had a problem.</h1><p>Try returning to the marketplace. If this continues, contact BUYSELL support.</p><Link className="button button--primary" to="/">Return home</Link></main>;
}

const sellerSections = ['products', 'inventory', 'orders', 'customers', 'messages', 'analytics', 'payouts', 'advertising', 'referrals', 'team', 'verification', 'sourcing', 'settings'];
const supplierSections = ['profile', 'catalog', 'requests', 'orders', 'messages', 'analytics', 'verification', 'settings'];
const adminSections = ['users', 'buyers', 'sellers', 'suppliers', 'products', 'categories', 'orders', 'payments', 'commissions', 'payouts', 'disputes', 'kyc', 'sourcing', 'advertising', 'broadcasts', 'messages', 'notifications', 'analytics', 'audit-logs', 'settings', 'content'];

const router = createBrowserRouter([
  {
    element: <MarketplaceLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'marketplace', element: <HomePage /> },
      { path: 'products', element: <CatalogPage /> },
      { path: 'search', element: <CatalogPage /> },
      { path: 'category/:categorySlug', element: <CatalogPage /> },
      { path: 'category/:categorySlug/:subcategorySlug', element: <CatalogPage /> },
      { path: 'product/:productSlug', element: <ProductPage /> },
      { path: 'store/:storeSlug', element: <StorePage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'service/:serviceId', element: <ServiceDetailPage /> },
      { path: 'sourcing', element: <SourcingPage /> },
      { path: 'rfq', element: <RfqPage /> },
      { path: 'upcoming', element: <UpcomingPage /> },
      ...['about', 'how-it-works', 'how-to-buy', 'how-to-sell', 'buyer-protection', 'seller-protection', 'delivery', 'safety', 'help', 'faq', 'contact', 'terms', 'privacy', 'cookies', 'refund-policy', 'prohibited-items'].map((page) => ({ path: page, element: <InfoPage page={page} /> })),
      { path: 'help/:articleSlug', element: <HelpArticlePage /> },
      { path: 'cart', element: <CartPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'checkout', element: <CheckoutPage /> },
          { path: 'checkout/success', element: <CheckoutSuccessPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:orderId', element: <OrderDetailPage /> },
          { path: 'wishlist', element: <BuyerCollectionPage kind="wishlist" /> },
          { path: 'messages', element: <BuyerCollectionPage kind="messages" /> },
          { path: 'messages/:conversationId', element: <ConversationPage /> },
          { path: 'account', element: <AccountPage /> },
          { path: 'account/profile', element: <AccountPage section="profile" /> },
          { path: 'account/addresses', element: <AccountPage section="addresses" /> },
          { path: 'account/security', element: <AccountPage section="security" /> },
          { path: 'account/notifications', element: <AccountPage section="notifications" /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/signup', element: <SignupChoicePage /> },
  { path: '/signup/buyer', element: <AuthPage mode="signup" intent="buyer" /> },
  { path: '/signup/seller', element: <AuthPage mode="signup" intent="seller" /> },
  { path: '/signup/supplier', element: <AuthPage mode="signup" intent="supplier" /> },
  { path: '/forgot-password', element: <AuthPage mode="forgot" /> },
  { path: '/reset-password', element: <AuthPage mode="reset" /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/seller',
        element: <WorkspaceLayout kind="seller" />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage kind="seller" /> },
          { path: 'onboarding', element: <SellerOnboardingPage /> },
          { path: 'store', element: <SellerStorePage /> },
          { path: 'store/customize', element: <SellerStorePage customize /> },
          { path: 'products/new', element: <ProductEditorPage /> },
          { path: 'products/:productId/edit', element: <ProductEditorPage edit /> },
          { path: 'finance', element: <FinancePage /> },
          { path: 'finance/transactions', element: <WorkspaceListPage kind="seller" section="finance" /> },
          { path: 'advertising/new', element: <WorkspaceDetailPage kind="seller" section="advertising" /> },
          { path: 'advertising/:campaignId', element: <WorkspaceDetailPage kind="seller" section="advertising" /> },
          { path: 'sourcing/new', element: <SellerSourcingEditorPage /> },
          { path: 'sourcing/:requestId', element: <SellerSourcingEditorPage /> },
          ...sellerSections.map((section) => ({ path: section, element: <WorkspaceListPage kind="seller" section={section} /> })),
          { path: 'products/:productId', element: <WorkspaceDetailPage kind="seller" section="products" /> },
          { path: 'orders/:orderId', element: <WorkspaceDetailPage kind="seller" section="orders" /> },
          { path: 'messages/:conversationId', element: <WorkspaceDetailPage kind="seller" section="messages" /> },
        ],
      },
      {
        path: '/supplier',
        element: <WorkspaceLayout kind="supplier" />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage kind="supplier" /> },
          ...supplierSections.map((section) => ({ path: section, element: <WorkspaceListPage kind="supplier" section={section} /> })),
          { path: 'requests/:requestId', element: <WorkspaceDetailPage kind="supplier" section="requests" /> },
          { path: 'orders/:orderId', element: <WorkspaceDetailPage kind="supplier" section="orders" /> },
        ],
      },
      {
        element: <RequireAdmin />,
        children: [
          {
            path: '/admin',
            element: <WorkspaceLayout kind="admin" />,
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: 'dashboard', element: <DashboardPage kind="admin" /> },
              { path: 'finance', element: <FinancePage admin /> },
              { path: 'broadcasts/new', element: <AdminBroadcastEditorPage /> },
              { path: 'broadcasts/:campaignId', element: <AdminBroadcastEditorPage /> },
              ...adminSections.map((section) => ({ path: section, element: <AdminListPage section={section} /> })),
              ...['users', 'sellers', 'suppliers', 'products', 'orders', 'disputes', 'kyc', 'sourcing', 'advertising'].map((section) => ({ path: `${section}/:${section.slice(0, -1)}Id`, element: <WorkspaceDetailPage kind="admin" section={section} /> })),
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return <Providers><Suspense fallback={<main className="route-state"><PageLoader /></main>}><RouterProvider router={router} /></Suspense></Providers>;
}
