'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
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
    setQuery('');
    setSuggestions([]);
    setShowDropdown(false);
  }, [pathname]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.matches || []);
          setShowDropdown(true);
        }
      } catch (err) {
        console.error("Search error", err);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(() => {
      fetchSuggestions();
    }, 300);

    return () => clearTimeout(debounce);
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setShowDropdown(false);
      router.push(`/?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', maxWidth: '600px' }}>
      <form onSubmit={handleSubmit} className="search-section" style={{ margin: 0, width: '100%' }}>
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          className="search-input" 
          placeholder="Найти по названию (например, Нимесил)..." 
        />
        <button type="submit" className="search-submit">
          {loading ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spinner"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          )}
        </button>
      </form>

      {showDropdown && suggestions.length > 0 && (
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
          {suggestions.map((item, idx) => {
            const rawPrice = Number(item.price);
            const sellingPrice = Math.ceil(rawPrice * 1.05);
            
            const isValidText = (text: string | null) => {
              if (!text) return false;
              if (text.includes(',')) return false;
              if (text.includes('*')) return false;
              return true;
            };

            const displaySubtitle = isValidText(item.country) ? item.country : (isValidText(item.vendor) ? item.vendor : '');

            return (
              <div 
                key={idx}
                onClick={() => {
                  setQuery(item.name);
                  setShowDropdown(false);
                  router.push(`/medicine/${encodeURIComponent(item.name)}`);
                }}
                style={{
                  padding: '12px 15px',
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.2s',
                  opacity: item.in_stock !== false ? 1 : 0.55
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f9f9f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
              >
                <div>
                  <div style={{ fontWeight: '500', color: '#333' }}>{item.name}</div>
                  {displaySubtitle && <div style={{ fontSize: '12px', color: '#888' }}>{displaySubtitle}</div>}
                  {item.in_stock === false && <div style={{ fontSize: '11px', color: '#c62828' }}>Нет в наличии</div>}
                </div>
                <div style={{ color: 'var(--primary)', fontWeight: 'bold' }}>
                  {sellingPrice} с.
                </div>
              </div>
            );
          })}
          <div 
            onClick={handleSubmit}
            style={{
              padding: '12px 15px',
              background: '#f5f5f5',
              cursor: 'pointer',
              textAlign: 'center',
              fontWeight: '500',
              color: 'var(--primary)'
            }}
          >
            Показать все результаты &rarr;
          </div>
        </div>
      )}
    </div>
  );
}
