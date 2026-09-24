import StaffShell from './StaffShell';
import './staff.css';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell>{children}</StaffShell>;
}
