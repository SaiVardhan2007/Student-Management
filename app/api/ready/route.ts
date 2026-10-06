import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

// readiness: the database is reachable (used by Docker / load balancers)
export async function GET() {
  let ready = false;
  try {
    await connectDB();
    ready = mongoose.connection.readyState === 1;
  } catch {
    ready = false;
  }
  return NextResponse.json({ success: ready, message: ready ? 'Ready' : 'Database not connected' }, { status: ready ? 200 : 503 });
}
