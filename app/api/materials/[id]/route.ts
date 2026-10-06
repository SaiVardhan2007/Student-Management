import { route } from '@/lib/api';
import * as m from '@/services/material.service';

export const DELETE = route({ roles: ['admin', 'faculty'] }, m.remove);
