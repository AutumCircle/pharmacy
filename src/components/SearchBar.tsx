'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { MedicineSearchResponse, PublicMedicine } from '@/lib/api-v1/types';

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PublicMedicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear search when navigating to a new page
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery('');
      setSuggestions([]);
      setShowDropdown(false);
      setSearchSubmitted(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      const normalizedQuery = query.trim();
      if (searchSubmitted || normalizedQuery.length < 2) {
        requestRef.current?.abort();
        setSuggestions([]);
        setShowDropdown(false);
        setLoading(false);
        return;
      }
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}&limit=8`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json() as MedicineSearchResponse;
          setSuggestions(data.data || []);
          setShowDropdown(true);
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error("Search error", err);
      } finally {
        if (requestRef.current === controller) setLoading(false);
      }
    };

    const debounce = setTimeout(() => {
      fetchSuggestions();
    }, 180);

    return () => {
      clearTimeout(debounce);
      requestRef.current?.abort();
    };
  }, [query, searchSubmitted]);

  const runSearch = () => {
    if (query.trim()) {
      inputRef.current?.blur();
      requestRef.current?.abort();
      setSearchSubmitted(true);
      setSuggestions([]);
      setShowDropdown(false);
      router.push(`/?q=${encodeURIComponent(query)}`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  return (
    <div ref={wrapperRef} className="search-wrapper">
      <form onSubmit={handleSubmit} className="search-section" style={{ margin: 0, width: '100%' }}>
        <input 
          ref={inputRef}
          type="text" 
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchSubmitted(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
              runSearch();
            }
          }}
          onFocus={() => { if (!searchSubmitted && suggestions.length > 0) setShowDropdown(true); }}
          className="search-input" 
          placeholder="Найти по названию среди более 10 000 лекарств"
        />
        <button type="submit" className="search-submit" aria-label="Найти">
          {loading ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spinner"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          )}
        </button>
      </form>

      {showDropdown && query.trim().length >= 2 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          marginTop: '8px',
          zIndex: 100,
          overflow: 'hidden',
          border: '1px solid #eee'
        }}>
          {suggestions.map((item) => {
            return (
              <button
                type="button"
                key={item.medicine_id}
                onClick={() => {
                  inputRef.current?.blur();
                  setQuery(item.medicine_name);
                  setShowDropdown(false);
                  router.push(`/medicine/${item.medicine_id}`);
                }}
                style={{
                  padding: '12px 15px',
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.2s',
                  border: 0,
                  width: '100%',
                  textAlign: 'left',
                  opacity: item.in_stock ? 1 : 0.55
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f9f9f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
              >
                <div>
                  <div style={{ fontWeight: '500', color: '#333' }}>{item.medicine_name}</div>
                  {item.in_stock === false && <div style={{ fontSize: '11px', color: '#c62828' }}>Нет в наличии</div>}
                </div>
                <div style={{ color: 'var(--primary)', fontWeight: 'bold' }}>
                  {item.selling_unit_price} с.
                </div>
              </button>
            );
          })}
          {suggestions.length === 0 && !loading && (
            <div style={{ padding: '14px 15px', color: '#666', textAlign: 'center' }}>
              Подходящих товаров не найдено
            </div>
          )}
          {(suggestions.length > 0 || loading) && (
            <button
              type="button"
              onClick={runSearch}
              style={{
                padding: '12px 15px',
                background: '#f5f5f5',
                cursor: 'pointer',
                textAlign: 'center',
                fontWeight: '500',
                color: 'var(--primary)',
                border: 0,
                width: '100%'
              }}
            >
              {loading ? 'Ищем…' : 'Показать все результаты →'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
