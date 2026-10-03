import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DynamicForm from '../components/DynamicForm.jsx';

const fields = [
  { name: 'firstName', label: 'First name', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'guardian.phone', label: 'Guardian phone', type: 'tel' },
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
];

describe('DynamicForm', () => {
  it('blocks submit and shows accessible errors when required fields are empty', async () => {
    const onSubmit = vi.fn();
    render(<DynamicForm fields={fields} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows format errors, then submits nested values once valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    render(<DynamicForm fields={fields} onSubmit={onSubmit} submitLabel="Create" />);
    await userEvent.type(screen.getByLabelText(/first name/i), 'Asha');
    await userEvent.type(screen.getByLabelText(/^email/i), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/^email/i));
    await userEvent.type(screen.getByLabelText(/^email/i), 'asha@example.edu');
    await userEvent.type(screen.getByLabelText(/guardian phone/i), '9876543210');
    await userEvent.selectOptions(screen.getByLabelText(/status/i), 'inactive');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ firstName: 'Asha', email: 'asha@example.edu', guardian: { phone: '9876543210' }, status: 'inactive' });
  });

  it('maps API validation errors back onto fields and shows a useful message', async () => {
    const err = { response: { status: 400, data: { message: 'Validation failed', errors: [{ field: 'email', message: 'Already exists' }] } } };
    render(<DynamicForm fields={fields} initial={{ firstName: 'A', email: 'a@b.co' }} onSubmit={() => Promise.reject(err)} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('Already exists')).toBeInTheDocument();
    expect(screen.getByText('Validation failed')).toBeInTheDocument();
  });
});
