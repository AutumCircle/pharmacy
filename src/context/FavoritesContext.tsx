'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface FavoriteItem {
  name: string;
  price: number;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
}

interface FavoritesContextType {
  items: FavoriteItem[];
  addFavorite: (item: FavoriteItem) => void;
  removeFavorite: (name: string) => void;
  isFavorite: (name: string) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('vatan_favorites');
    if (saved) {
      try {
        setItems(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse favorites:', e);
      }
    }
  }, []);

  const saveItems = (newItems: FavoriteItem[]) => {
    setItems(newItems);
    localStorage.setItem('vatan_favorites', JSON.stringify(newItems));
  };

  const addFavorite = (item: FavoriteItem) => {
    if (!items.find(i => i.name === item.name)) {
      saveItems([...items, item]);
    }
  };

  const removeFavorite = (name: string) => {
    saveItems(items.filter(item => item.name !== name));
  };

  const isFavorite = (name: string) => {
    return items.some(item => item.name === name);
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
