'use client';

import toast from 'react-hot-toast';
import { errorMessage, openFile } from '@/lib/api-client';
import Icon from '@/components/ui/icon';
import { fmtSize } from '@/lib/format';

/** Link to a protected upload (fetched with the auth header, then opened/downloaded). */
export default function FileLink({ file, label }: any) {
  if (!file?.path) return <span className="faint">—</span>;
  const open = async (e) => {
    e.preventDefault();
    // PDFs and images open in a new tab; every other file type is downloaded
    const canShowInBrowser = /\.(pdf|png|jpe?g)$/i.test(file.path);
    try {
      await openFile(file.path, { download: !canShowInBrowser, name: file.originalName });
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to open the file.'));
    }
  };
  return (
    <a href="#file" onClick={open} className="row" style={{ gap: 4, display: 'inline-flex' }} title={file.originalName}>
      <Icon name="paperclip" size={14} /> {label || file.originalName}
      {file.size ? <span className="faint small"> ({fmtSize(file.size)})</span> : null}
    </a>
  );
}
