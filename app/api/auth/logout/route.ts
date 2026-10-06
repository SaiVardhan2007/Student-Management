import { route } from '@/lib/api';
import { logout } from '@/services/auth.service';

// public on purpose: signing out must work even after the access token has expired
export const POST = route({ public: true }, logout);
