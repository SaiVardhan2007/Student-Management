import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataTable, { Pagination } from '../components/DataTable.jsx';
import { Badge, EmptyState, ErrorState, Modal, ProgressBar } from '../components/ui.jsx';
import { ConfirmProvider, useConfirm } from '../components/Confirm.jsx';

const cols = [{ key: 'name', label: 'Name', sortKey: 'name' }, { key: 'age', label: 'Age' }];
const row = { _id: '1', name: 'Asha', age: 20 };

describe('DataTable', () => {
  it('renders rows, empty and error states', () => {
    const { rerender } = render(<DataTable columns={cols} rows={[row]} />);
    expect(screen.getByText('Asha')).toBeInTheDocument();
    rerender(<DataTable columns={cols} rows={[]} />);
    expect(screen.getByText('No records found')).toBeInTheDocument();
    rerender(<DataTable columns={cols} rows={[]} error="Boom" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('toggles sort direction from the header', async () => {
    const onSort = vi.fn();
    const { rerender } = render(<DataTable columns={cols} rows={[row]} sort="" onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenLastCalledWith('name');
    rerender(<DataTable columns={cols} rows={[row]} sort="name" onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSort).toHaveBeenLastCalledWith('-name');
  });
});

describe('Pagination', () => {
  it('shows the range and disables the first-page previous button', async () => {
    const onPage = vi.fn();
    render(<Pagination meta={{ page: 1, limit: 10, total: 25, pages: 3 }} page={1} onPage={onPage} />);
    expect(screen.getByText('Showing 1–10 of 25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('ui primitives', () => {
  it('Badge picks a tone from the status value', () => {
    render(<><Badge value="verified" /><Badge value="absent" /></>);
    expect(screen.getByText('Verified')).toHaveClass('badge-success');
    expect(screen.getByText('Absent')).toHaveClass('badge-danger');
  });

  it('ProgressBar exposes aria values and flags values below the threshold', () => {
    render(<ProgressBar value={60} threshold={75} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar).toHaveClass('bad');
  });

  it('EmptyState and ErrorState render messages', () => {
    render(<><EmptyState title="Nothing" message="Add one" /><ErrorState message="Failed" /></>);
    expect(screen.getByText('Add one')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });

  it('Modal is labelled and closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Modal title="Edit thing" onClose={onClose}><input aria-label="x" /></Modal>);
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('confirm dialog', () => {
  function Demo({ onResult }) {
    const confirm = useConfirm();
    return <button onClick={async () => onResult(await confirm({ title: 'Delete?', message: 'Really?', danger: true, confirmLabel: 'Yes, delete' }))}>ask</button>;
  }

  it('resolves true on confirm and false on cancel (no browser alert)', async () => {
    const onResult = vi.fn();
    render(<ConfirmProvider><Demo onResult={onResult} /></ConfirmProvider>);
    await userEvent.click(screen.getByText('ask'));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onResult).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByText('ask'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});
