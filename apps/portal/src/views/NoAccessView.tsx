// Landing for authenticated callers who are not on the roster yet. Their
// sign-in has been recorded as an access request.
import { ShieldAlert } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { logout } from '../lib/auth/userManager';
import { PORTAL_NAME } from '../lib/api/config';

export function NoAccessView({ email }: { email: string | null }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <EmptyState
        icon={<ShieldAlert size={40} strokeWidth={1.5} />}
        title="Access pending"
        body={`You're signed in${email ? ` as ${email}` : ''}, but your account isn't on the ${PORTAL_NAME} access roster yet. An administrator can grant access from Roles & access; your request has been recorded.`}
        action={
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        }
      />
    </div>
  );
}
