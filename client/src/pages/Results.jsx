import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from '../hooks/index.js';
import { EmptyState, PageHeader, PageLoader } from '../components/ui.jsx';
import { ResultsView } from './StudentDetail.jsx';
import { fullName } from '../utils/format.js';

export default function Results() {
  const { user } = useAuth();
  const isParent = user.role === 'parent';
  const kids = useFetch('/students', { limit: 50 }, { enabled: isParent });
  const [kid, setKid] = useState('');
  if (isParent && kids.loading) return <PageLoader />;
  if (isParent && !kids.data?.length) return <EmptyState icon="users" title="No linked students" />;
  const id = isParent ? kid || kids.data[0]._id : 'me';
  return (
    <div className="page">
      <PageHeader
        title="Results"
        subtitle="Subject marks, grades, SGPA and CGPA"
        actions={
          isParent &&
          kids.data.length > 1 && (
            <select className="select" aria-label="Select child" value={id} onChange={(e) => setKid(e.target.value)}>
              {kids.data.map((c) => (
                <option key={c._id} value={c._id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          )
        }
      />
      <ResultsView studentId={id} />
    </div>
  );
}
