import { notFound } from 'next/navigation';
import { ApiV1Error, getPublicMedicine } from '@/lib/api-v1/server';
import ProductDetailsClient from './ProductDetailsClient';

export default async function MedicinePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const medicineId = Number(name);
  if (!Number.isInteger(medicineId) || medicineId <= 0) notFound();
  let product;
  try {
    product = (await getPublicMedicine(medicineId)).data;
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="container" style={{ paddingTop: '30px' }}>
      <ProductDetailsClient product={product} />
    </div>
  );
}
