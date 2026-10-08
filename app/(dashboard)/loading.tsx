import { PageLoader } from '@/components/ui';

// Shown instantly when switching pages (also lets Next.js prefetch every dashboard page up to this point).
export default function Loading() {
  return <PageLoader />;
}
