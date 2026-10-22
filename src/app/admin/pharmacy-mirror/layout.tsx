import { requireAdminSession } from '@/lib/admin-auth';
import './mirror.css';
export default async function MirrorLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  return <div className="pharmacy-mirror">{children}</div>;
}
