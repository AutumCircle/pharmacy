'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface CartItem {
  name: string;
  price: number;
  country: string | null;
  vendor: string | null;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (name: string) => void;
  updateQuantity: (name: string, quantity: number) => void;
  clearCart: () => void;
  totalPrice: number;
  totalItems: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem('vatan_cart');
    if (saved) {
      try {
        setItems(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse cart');
      }
    }
  }, []);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('vatan_cart', JSON.stringify(items));
    }
  }, [items, isMounted]);

  const addItem = (newItem: Omit<CartItem, 'quantity'>) => {
    setItems((prev) => {
      // Basic sanitization check for garbage characters
      const sanitize = (text: string | null) => {
        if (!text) return null;
        if (text.includes(',') || text.includes('*')) return null;
        return text.trim();
      };

      const cleanItem = {
        ...newItem,
        country: sanitize(newItem.country),
        vendor: sanitize(newItem.vendor)
      };

      const existing = prev.find((i) => i.name === cleanItem.name);
      if (existing) {
        return prev.map((i) =>
          i.name === cleanItem.name ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...cleanItem, quantity: 1 }];
    });
  };

  const removeItem = (name: string) => {
    setItems((prev) => prev.filter((i) => i.name !== name));
  };

  const updateQuantity = (name: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(name);
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.name === name ? { ...i, quantity } : i))
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Return a generic context if not mounted to prevent hydration errors
  if (!isMounted) {
    return (
      <CartContext.Provider value={{ items: [], addItem, removeItem, updateQuantity, clearCart, totalPrice: 0, totalItems: 0 }}>
        {children}
      </CartContext.Provider>
    );
  }

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, totalPrice, totalItems }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
