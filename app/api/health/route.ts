import { route, ok } from '@/lib/api';

export const GET = route({ public: true }, async () => ok({ uptime: process.uptime() }, 'OK'));
