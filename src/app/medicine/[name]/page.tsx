import { getMedicines } from '@/lib/api';
import ProductDetailsClient from './ProductDetailsClient';

export default async function MedicinePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  
  return (
    <div className="container" style={{ paddingTop: '30px' }}>
      <ProductDetailsClient medicineName={decodedName} />
    </div>
  );
}
