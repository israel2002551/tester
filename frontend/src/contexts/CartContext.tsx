import { createContext, use, useMemo, type PropsWithChildren } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Cart } from '../lib/types';

const emptyCart: Cart = { items: [], itemCount: 0, subtotal: 0 };

interface CartContextValue {
  cart: Cart;
  loading: boolean;
  error: Error | null;
  adding: boolean;
  addItem: (productId: string, quantity?: number, variantId?: string) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const cartQuery = useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<Cart>('/cart'),
    retry: 1,
    staleTime: 15_000,
  });

  const syncCart = (cart: Cart) => queryClient.setQueryData(['cart'], cart);
  const addMutation = useMutation({
    mutationFn: async (input: { productId: string; quantity: number; variantId?: string }) => {
      const variantId = input.variantId ?? input.productId;
      await api.put(`/cart/items/${encodeURIComponent(variantId)}`, { quantity: input.quantity });
      return api.get<Cart>('/cart');
    },
    onSuccess: syncCart,
  });
  const updateMutation = useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      await api.put(`/cart/items/${encodeURIComponent(itemId)}`, { quantity });
      return api.get<Cart>('/cart');
    },
    onSuccess: syncCart,
  });
  const removeMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await api.delete(`/cart/items/${encodeURIComponent(itemId)}`);
      return api.get<Cart>('/cart');
    },
    onSuccess: syncCart,
  });

  const value = useMemo<CartContextValue>(() => ({
    cart: cartQuery.data ?? emptyCart,
    loading: cartQuery.isLoading,
    error: cartQuery.error,
    adding: addMutation.isPending,
    addItem: async (productId, quantity = 1, variantId) => { await addMutation.mutateAsync({ productId, quantity, variantId }); },
    updateItem: async (itemId, quantity) => { await updateMutation.mutateAsync({ itemId, quantity }); },
    removeItem: async (itemId) => { await removeMutation.mutateAsync(itemId); },
  }), [cartQuery.data, cartQuery.isLoading, cartQuery.error, addMutation, updateMutation, removeMutation]);

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart() {
  const context = use(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
