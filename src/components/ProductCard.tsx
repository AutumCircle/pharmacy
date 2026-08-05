'use client';

import { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import { sanitizeText } from '../lib/utils';

export default function ProductCard({ item }: { item: any }) {
  const { items, addItem, updateQuantity, removeItem } = useCart();
  const { isFavorite, addFavorite, removeFavorite } = useFavorites();
  const [addedToCart, setAddedToCart] = useState(false);
  
  const cartItem = items.find(i => i.name === item.name);
  const qtyInCart = cartItem ? cartItem.quantity : 0;

  const favorite = isFavorite(item.name);

  // 1. Math and Margin: 5% margin, Math.ceil
  const rawPrice = Number(item.price);
  const sellingPrice = Math.ceil(rawPrice * 1.05);

  // 2. Sanitizing vendor/country
  const cleanCountry = sanitizeText(item.country);
  const cleanVendor = sanitizeText(item.vendor);

  const showCountry = !!cleanCountry;
  const showVendor = !!cleanVendor;

  // 3. Out of stock logic
  const inStock = item.in_stock !== false; // handle missing field as true to be safe

  const toggleFavorite = () => {
    if (favorite) removeFavorite(item.name);
    else addFavorite(item);
  };

  const handleAddToCart = () => {
    if (!inStock) return;
    addItem({
      name: item.name,
      price: sellingPrice,
      country: item.country,
      vendor: item.vendor,
      quantity: 1
    });
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 2000);
  };

  return (
    <div 
      className="medicine-card" 
      style={{ 
        padding: '20px', 
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        opacity: inStock ? 1 : 0.55,
        filter: inStock ? 'none' : 'grayscale(100%)',
        pointerEvents: inStock ? 'auto' : 'none'
      }}
    >
      <div className="card-top-icons" style={{ pointerEvents: 'auto', display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <button className={`card-icon-btn ${favorite ? 'active-fav' : ''}`} onClick={(e) => { e.preventDefault(); toggleFavorite(); }} style={{ color: favorite ? 'var(--primary)' : '#ccc', pointerEvents: 'auto' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={favorite ? 'var(--primary)' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
        </button>
      </div>
      
      <a href={`/medicine/${encodeURIComponent(item.name)}`} style={{ textDecoration: 'none', color: 'inherit', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="card-image" style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', height: '120px' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#eee" strokeWidth="1.5">
            <rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect>
            <path d="M5 7h14"></path>
            <path d="M12 11v4"></path>
            <path d="M10 13h4"></path>
            <path d="M9 3h6v4H9z"></path>
          </svg>
        </div>
        
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <h3 className="card-name" title={item.name} style={{ fontSize: '14px', fontWeight: 500, color: '#333', marginBottom: '8px' }}>
            {item.name}
          </h3>
          
          {showCountry && <p className="card-country" style={{ color: '#999', fontSize: '12px', margin: '0 0 2px 0' }}>Страна: {cleanCountry}</p>}
          {showVendor && <p className="card-vendor" style={{ color: '#999', fontSize: '12px', margin: '0 0 2px 0' }}>Производитель: {cleanVendor}</p>}
        </div>
      </a>
      
      <div className="card-price" style={{ color: 'var(--primary)', fontSize: '18px', fontWeight: 'bold', margin: '15px 0' }}>
        {sellingPrice} с.
      </div>
      
      {!inStock ? (
        <button 
          className="add-to-cart-btn" 
          style={{ width: '100%', padding: '12px', border: 'none', borderRadius: '24px', fontWeight: 600, background: '#ccc', cursor: 'not-allowed', color: '#666' }}
          disabled
        >
          Нет в наличии
        </button>
      ) : qtyInCart > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: '#F5F5F7', borderRadius: '24px', padding: '5px' }}>
            <button 
              onClick={(e) => { e.preventDefault(); updateQuantity(item.name, qtyInCart - 1); }}
              style={{ background: 'none', border: 'none', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            <span style={{ fontWeight: '600', fontSize: '15px', width: '24px', textAlign: 'center' }}>{qtyInCart}</span>
            <button 
              onClick={(e) => { e.preventDefault(); updateQuantity(item.name, qtyInCart + 1); }}
              style={{ background: 'none', border: 'none', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
          </div>
          <button 
            onClick={(e) => { e.preventDefault(); removeItem(item.name); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          <a href="/cart" style={{ color: '#555', padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          </a>
        </div>
      ) : (
        <button 
          className="add-to-cart-btn" 
          style={{ width: '100%', padding: '12px', border: 'none', borderRadius: '24px', fontWeight: 600, background: 'var(--primary)', cursor: 'pointer', color: 'white' }}
          onClick={(e) => { e.preventDefault(); handleAddToCart(); }}
        >
          В корзину
        </button>
      )}
    </div>
  );
}
