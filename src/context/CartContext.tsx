'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { resolveMedicinesClient } from '@/lib/api-v1/client-reads';

export interface CartItem {
  medicine_id: number;
  medicine_name: string;
  selling_unit_price: number;
  currency: 'TJS';
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
  quantity: number;
}

async function refreshCatalogItems(items: CartItem[]): Promise<CartItem[]> {
  if (!items.length) return items;
  try {
    const payload = await resolveMedicinesClient(items.map((item) => item.medicine_id));
    const current = new Map(payload.data.medicines.map((medicine) => [medicine.medicine_id, medicine]));
    return items.map((item) => {
      const medicine = current.get(item.medicine_id);
      return medicine ? {
        ...item,
        medicine_name: medicine.medicine_name,
        selling_unit_price: medicine.selling_unit_price,
        currency: medicine.currency,
        country: medicine.country,
        vendor: medicine.vendor,
        in_stock: medicine.in_stock,
      } : { ...item, in_stock: false };
    });
  } catch {
    return items;
  }
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (medicineId: number) => void;
  updateQuantity: (medicineId: number, quantity: number) => void;
  clearCart: () => void;
  totalPrice: number;
  totalItems: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem('vatan_cart_v1');
      if (saved) {
        try {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.every((item) => (
            item && typeof item === 'object'
            && Number.isInteger((item as CartItem).medicine_id)
            && typeof (item as CartItem).medicine_name === 'string'
            && Number.isFinite((item as CartItem).selling_unit_price)
            && Number.isInteger((item as CartItem).quantity)
          ))) {
            const normalized = (parsed as CartItem[]).map((item) => ({
              ...item,
              in_stock: item.in_stock !== false,
            }));
            setItems(normalized);
            void refreshCatalogItems(normalized).then(setItems);
          }
        } catch {
          console.error('Failed to parse cart');
        }
      }
      hydrated.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated.current) {
      localStorage.setItem('vatan_cart_v1', JSON.stringify(items));
    }
  }, [items]);

  const addItem = (newItem: Omit<CartItem, 'quantity'>) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.medicine_id === newItem.medicine_id);
      if (existing) {
        return prev.map((i) =>
          i.medicine_id === newItem.medicine_id ? { ...i, quantity: Math.min(99, i.quantity + 1) } : i
        );
      }
      return [...prev, { ...newItem, quantity: 1 }];
    });
  };

  const removeItem = (medicineId: number) => {
    setItems((prev) => prev.filter((i) => i.medicine_id !== medicineId));
  };

  const updateQuantity = (medicineId: number, quantity: number) => {
    if (quantity <= 0) {
      removeItem(medicineId);
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.medicine_id === medicineId ? { ...i, quantity: Math.min(99, quantity) } : i))
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.selling_unit_price * i.quantity, 0);

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
