'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { PublicMedicine } from '@/lib/api-v1/types';
import { resolveMedicinesClient } from '@/lib/api-v1/client-reads';

export type FavoriteItem = PublicMedicine;

interface FavoritesContextType {
  items: FavoriteItem[];
  addFavorite: (item: FavoriteItem) => void;
  removeFavorite: (medicineId: number) => void;
  isFavorite: (medicineId: number) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

async function refreshFavorites(items: FavoriteItem[]): Promise<FavoriteItem[]> {
  if (!items.length) return items;
  try {
    const payload = await resolveMedicinesClient(items.slice(0, 50).map((item) => item.medicine_id));
    const current = new Map(payload.data.medicines.map((medicine) => [medicine.medicine_id, medicine]));
    return items.map((item) => current.get(item.medicine_id) || { ...item, in_stock: false });
  } catch {
    return items;
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem('vatan_favorites_v1');
      if (saved) {
        try {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.every((item) => (
            item && typeof item === 'object'
            && Number.isInteger((item as PublicMedicine).medicine_id)
            && typeof (item as PublicMedicine).medicine_name === 'string'
          ))) {
            const savedItems = parsed as FavoriteItem[];
            setItems(savedItems);
            void refreshFavorites(savedItems).then(setItems);
          }
        } catch (error) {
          console.error('Failed to parse favorites:', error);
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const saveItems = (newItems: FavoriteItem[]) => {
    setItems(newItems);
    localStorage.setItem('vatan_favorites_v1', JSON.stringify(newItems));
  };

  const addFavorite = (item: FavoriteItem) => {
    if (!items.find(i => i.medicine_id === item.medicine_id)) {
      saveItems([...items, item]);
    }
  };

  const removeFavorite = (medicineId: number) => {
    saveItems(items.filter(item => item.medicine_id !== medicineId));
  };

  const isFavorite = (medicineId: number) => {
    return items.some(item => item.medicine_id === medicineId);
  };

  return (
    <FavoritesContext.Provider value={{ items, addFavorite, removeFavorite, isFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
}
