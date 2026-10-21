import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../auth/AuthContext';
import { AuthProvider } from '../auth/AuthContext';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './PasswordPages';
import { SettingsPage } from './SettingsPage';
import { SignupPage } from './SignupPage';
import { NotFoundPage } from './StaticPages';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const anon: AuthContextValue = { status: 'anonymous', session: null, login: vi.fn(), logout: vi.fn() };

function withAuth(ui: React.ReactNode, path = '/', value: AuthContextValue = anon) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={ui} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('SignupPage validation', () => {
  it('shows every field error inline and sends nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider>
        <MemoryRouter>
          <SignupPage />
        </MemoryRouter>
      </AuthProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // silent refresh
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'abcdefgh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Hotel / company name is required.')).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(screen.getByText('Password needs: contains a number.')).toBeInTheDocument();
    expect(screen.getByText(/accept the Terms/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('derives the workspace URL from the hotel name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 401)));
    render(
      <AuthProvider>
        <MemoryRouter>
          <SignupPage />
        </MemoryRouter>
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Hotel / company name'), { target: { value: 'Café Résidence Goa' } });
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('cafe-residence-goa');
  });
});

describe('ForgotPasswordPage', () => {
  it('confirms without revealing whether the account exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    withAuth(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@hotel.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText(/If an account exists/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/auth/forgot-password');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'me@hotel.com' });
  });

  it('validates the email before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    withAuth(<ForgotPasswordPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordPage', () => {
  it('requires matching, strong passwords then sends the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    withAuth(<ResetPasswordPage />, '/reset-password?token=abcdefghijklmnopqrstuvwxyz');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpass123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass124' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords don’t match.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      token: 'abcdefghijklmnopqrstuvwxyz',
      password: 'newpass123',
    });
  });

  it('explains a missing token', () => {
    vi.stubGlobal('fetch', vi.fn());
    withAuth(<ResetPasswordPage />, '/reset-password');
    expect(screen.getByRole('heading', { name: 'Link is incomplete' })).toBeInTheDocument();
  });
});

describe('VerifyEmailPage', () => {
  it('verifies the token once and shows success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    withAuth(<VerifyEmailPage />, '/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the server reason when the link is expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'This link is invalid or has expired.' } }, false, 400)),
    );
    withAuth(<VerifyEmailPage />, '/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
  });
});

const PROFILE = {
  id: 'u1',
  email: 'owner@hotel.com',
  firstName: 'Asha',
  lastName: 'Rao',
  role: 'OWNER',
  organizationId: 'o1',
  emailVerifiedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  isDemo: false,
  organization: { id: 'o1', name: 'Rao Hotels', slug: 'rao-hotels' },
};

describe('SettingsPage', () => {
  const authed: AuthContextValue = { status: 'authenticated', session: null, login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined) };

  it('shows profile, verification status and lets the owner delete the account after confirming', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse({ user: PROFILE }));
      if (url.includes('/auth/account') && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({ deletedOrganization: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    withAuth(<SettingsPage />, '/app/settings', authed);

    expect((await screen.findAllByText('owner@hotel.com')).length).toBeGreaterThan(0);
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const confirm = screen.getByRole('button', { name: 'Delete forever' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Type "DELETE" to confirm'), { target: { value: 'DELETE' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(authed.logout).toHaveBeenCalled());
    const del = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/auth/account') && (i as RequestInit)?.method === 'DELETE');
    expect(JSON.parse(String((del?.[1] as RequestInit).body))).toEqual({ password: 'pw', confirm: 'DELETE' });
  });

  it('does not offer deletion on the shared demo account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ user: { ...PROFILE, isDemo: true } })));
    withAuth(<SettingsPage />, '/app/settings', authed);
    expect(await screen.findByText(/shared demo workspace/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
  });
});

describe('NotFoundPage', () => {
  it('names the missing path and offers a way home', () => {
    withAuth(<NotFoundPage />, '/does/not/exist');
    expect(screen.getByRole('heading', { name: /isn’t on the map/ })).toBeInTheDocument();
    expect(screen.getByText('/does/not/exist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to homepage' })).toHaveAttribute('href', '/');
  });
});
