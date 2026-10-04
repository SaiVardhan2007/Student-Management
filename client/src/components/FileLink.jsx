import toast from 'react-hot-toast';
import { errorMessage, openFile } from '../api/client.js';
import Icon from './Icon.jsx';
import { fmtSize } from '../utils/format.js';

/** Link to a protected upload (fetched with the auth header, then opened/downloaded). */
export default function FileLink({ file, label }) {
  if (!file?.path) return <span className="faint">—</span>;
  const open = async (e) => {
    e.preventDefault();
    try {
      await openFile(file.path, { download: !/\.(pdf|png|jpe?g)$/i.test(file.path), name: file.originalName });
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
