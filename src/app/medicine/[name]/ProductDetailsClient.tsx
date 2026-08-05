'use client';

import { useState, useEffect } from 'react';
import { useCart } from '@/context/CartContext';
import { useFavorites } from '@/context/FavoritesContext';
import { sanitizeText, calculateSellingPrice } from '@/lib/utils';
import Link from 'next/link';

export default function ProductDetailsClient({ medicineName }: { medicineName: string }) {
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { addItem, items, updateQuantity, removeItem } = useCart();
  const { isFavorite, addFavorite, removeFavorite } = useFavorites();
  
  const favorite = isFavorite(medicineName);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(medicineName)}`);
        const data = await res.json();
        const match = data.matches?.find((m: any) => m.name === medicineName);
        if (match) {
          setProduct(match);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [medicineName]);

  if (loading) return <div style={{ padding: '50px', textAlign: 'center' }}>Загрузка...</div>;
  if (!product) return <div style={{ padding: '50px', textAlign: 'center' }}>Товар не найден</div>;

  const sellingPrice = calculateSellingPrice(product.price);
  const inStock = product.in_stock !== false;
  
  const cleanCountry = sanitizeText(product.country);
  const cleanVendor = sanitizeText(product.vendor);
  
  const cartItem = items.find(i => i.name === product.name);
  const qtyInCart = cartItem ? cartItem.quantity : 0;

  const toggleFavorite = () => {
    if (favorite) removeFavorite(product.name);
    else addFavorite(product);
  };

  const handleAddToCart = () => {
    if (!inStock) return;
    addItem({
      name: product.name,
      price: sellingPrice,
      country: product.country,
      vendor: product.vendor,
      quantity: 1
    });
  };

  return (
    <div>
      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '30px', color: '#333' }}>
        {product.name}
      </h1>
      
      <div className="product-details-grid" style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr 350px', 
        gap: '30px',
        alignItems: 'start' 
      }}>
        
        {/* Left: Image */}
        <div style={{ 
          background: 'white', 
          borderRadius: '16px', 
          border: '1px solid #E0E0E0',
          padding: '40px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '400px'
        }}>
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#eee" strokeWidth="1.5">
            <rect x="7" y="7" width="10" height="14" rx="2" ry="2"></rect>
            <path d="M5 7h14"></path>
            <path d="M12 11v4"></path>
            <path d="M10 13h4"></path>
            <path d="M9 3h6v4H9z"></path>
          </svg>
        </div>

        {/* Middle: Attributes */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div className="attr-row">
              <span className="attr-label">Производитель</span>
              <span className="attr-dots"></span>
              <span className="attr-value" style={{ color: 'var(--primary)' }}>{cleanVendor || 'Не указан'}</span>
            </div>
            <div className="attr-row">
              <span className="attr-label">Страна</span>
              <span className="attr-dots"></span>
              <span className="attr-value" style={{ color: 'var(--primary)' }}>{cleanCountry || 'Не указана'}</span>
            </div>
            <div className="attr-row">
              <span className="attr-label">Форма выпуска</span>
              <span className="attr-dots"></span>
              <span className="attr-value">Упаковка</span>
            </div>
            <div className="attr-row">
              <span className="attr-label">Вид товара</span>
              <span className="attr-dots"></span>
              <span className="attr-value">Лекарственное средство</span>
            </div>
          </div>
        </div>

        {/* Right: Sticky Action Card */}
        <div style={{ position: 'sticky', top: '90px' }}>
          
          <div style={{ 
            background: 'white', 
            borderRadius: '12px', 
            padding: '24px', 
            border: '1px solid #E0E0E0',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div style={{ color: '#888', fontSize: '14px' }}>Цена</div>
              <button onClick={toggleFavorite} style={{ background: 'none', border: 'none', cursor: 'pointer', color: favorite ? 'var(--primary)' : '#ccc' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill={favorite ? 'var(--primary)' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              </button>
            </div>
            
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '20px' }}>
              {sellingPrice.toFixed(2)} с.
            </div>

            <div style={{ color: inStock ? '#4CAF50' : '#F44336', fontSize: '14px', fontWeight: '500', marginBottom: '20px' }}>
              {inStock ? 'В наличии' : 'Нет в наличии'}
            </div>

            {qtyInCart === 0 ? (
              <button 
                onClick={handleAddToCart}
                disabled={!inStock}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: inStock ? 'var(--primary)' : '#ccc',
                  color: inStock ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: inStock ? 'pointer' : 'not-allowed'
                }}
              >
                {!inStock ? 'Нет в наличии' : 'В корзину'}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: '#F5F5F7', borderRadius: '24px', padding: '5px', flex: 1, justifyContent: 'space-between' }}>
                  <button 
                    onClick={(e) => { e.preventDefault(); updateQuantity(product.name, qtyInCart - 1); }}
                    style={{ background: 'none', border: 'none', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  ><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                  <span style={{ fontWeight: '600', fontSize: '16px', width: '30px', textAlign: 'center' }}>{qtyInCart}</span>
                  <button 
                    onClick={(e) => { e.preventDefault(); updateQuantity(product.name, qtyInCart + 1); }}
                    style={{ background: 'none', border: 'none', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  ><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                </div>
                <button 
                  onClick={(e) => { e.preventDefault(); removeItem(product.name); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <a href="/cart" style={{ color: '#555', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                </a>
              </div>
            )}
          </div>


        </div>
      </div>
    </div>
  );
}
