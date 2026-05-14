import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Download,
  Settings,
  FileText,
  Upload,
  X,
  FilePlus2,
  Image as ImageIcon,
  LogOut,
  Cloud,
  CloudOff,
} from 'lucide-react';
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/* ============================================================
   Helpers
   ============================================================ */
const newId = (prefix = '') =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const pad = (n) => String(n).padStart(2, '0');

const formatDate = (d) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

const todayPrefix = () => {
  const d = new Date();
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
};

const nextInvoiceNumber = (existing) => {
  const prefix = todayPrefix();
  const todays = existing.filter((i) => (i.invoiceNumber || '').startsWith(prefix));
  const nums = todays.map((i) => {
    const m = (i.invoiceNumber || '').match(/-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(next).padStart(5, '0')}`;
};

const formatCurrency = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const sumLineItems = (items) =>
  (items || []).reduce((s, i) => s + (Number(i.total) || 0), 0);

/* ============================================================
   Defaults
   ============================================================ */
const defaultBusinessInfo = {
  companyName: 'Your Company',
  tagline: 'Your tagline',
  logo: null,
  payment: {
    name: '',
    bankName: '',
    bankAddress: '',
    accountNumber: '',
    routingNumber: '',
  },
  signatureName: '',
  signatureTitle: 'Founder',
  footerMessage: 'Looking forward to our continued collaboration.',
};

const createBlankInvoice = (existing) => ({
  id: newId('inv_'),
  invoiceNumber: nextInvoiceNumber(existing),
  date: formatDate(new Date()),
  client: { name: '', phone: '', email: '', address: '' },
  lineItems: [{ id: newId('li_'), service: '', description: '', total: 0 }],
  updatedAt: Date.now(),
});

/* ============================================================
   Firestore helpers
   ============================================================ */
const invoicesCol = (uid) => collection(db, 'users', uid, 'invoices');
const invoiceDoc = (uid, id) => doc(db, 'users', uid, 'invoices', id);
const businessInfoDoc = (uid) => doc(db, 'users', uid, 'meta', 'businessInfo');

/* ============================================================
   Editable — click-to-edit contentEditable wrapper
   ============================================================ */
function Editable({
  initialValue,
  onSave,
  placeholder = '',
  className = '',
  style = {},
  multiline = false,
  tag = 'span',
}) {
  const ref = useRef(null);

  // Sync from prop changes (e.g. remote Firestore update), but only when
  // not focused — so we never clobber the user's in-progress typing.
  useEffect(() => {
    if (!ref.current) return;
    if (document.activeElement === ref.current) return;
    const next = initialValue || '';
    if (ref.current.innerText !== next) {
      ref.current.innerText = next;
    }
  }, [initialValue]);

  const Tag = tag;

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={(e) => {
        let text = e.currentTarget.innerText;
        if (!text.trim()) {
          e.currentTarget.innerHTML = '';
          text = '';
        }
        onSave(text);
      }}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          ref.current.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
      className={`editable ${className}`}
      style={style}
    />
  );
}

/* ============================================================
   Sign-In Screen
   ============================================================ */
function GoogleG({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.12-.84 2.07-1.79 2.71v2.25h2.9c1.7-1.56 2.69-3.87 2.69-6.6z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.46-.81 5.95-2.18l-2.9-2.25c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.32C2.44 15.98 5.48 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71A5.41 5.41 0 0 1 3.65 9c0-.6.1-1.17.27-1.71V4.97H.96A8.97 8.97 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.99-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}

function SignInScreen() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(null);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      console.error(e);
      if (
        e.code !== 'auth/popup-closed-by-user' &&
        e.code !== 'auth/cancelled-popup-request'
      ) {
        setError(e.message || 'Sign-in failed. Please try again.');
      }
      setSigningIn(false);
    }
  };

  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-mark">
          <FileText size={20} strokeWidth={2.5} />
        </div>
        <h1 className="signin-title">Invoice Generator</h1>
        <p className="signin-sub">
          Create invoices, save them to the cloud, and access them on any device.
        </p>
        <button className="google-btn" onClick={handleSignIn} disabled={signingIn}>
          <GoogleG />
          {signingIn ? 'Signing in…' : 'Continue with Google'}
        </button>
        {error && <div className="signin-error">{error}</div>}
        <div className="signin-foot">Your invoices are private to your account.</div>
      </div>
    </div>
  );
}

/* ============================================================
   Invoice Paper — the printable invoice itself
   ============================================================ */
function InvoicePaper({ invoice, businessInfo, totalDue, updateInvoice }) {
  const updateClient = (field, value) =>
    updateInvoice((inv) => ({ ...inv, client: { ...inv.client, [field]: value } }));

  const updateLineItem = (id, field, value) =>
    updateInvoice((inv) => ({
      ...inv,
      lineItems: inv.lineItems.map((li) =>
        li.id === id
          ? {
              ...li,
              [field]:
                field === 'total' ? Number(String(value).replace(/[^\d.]/g, '')) || 0 : value,
            }
          : li,
      ),
    }));

  const addLineItem = () =>
    updateInvoice((inv) => ({
      ...inv,
      lineItems: [
        ...inv.lineItems,
        { id: newId('li_'), service: '', description: '', total: 0 },
      ],
    }));

  const removeLineItem = (id) =>
    updateInvoice((inv) => {
      const next = inv.lineItems.filter((li) => li.id !== id);
      return {
        ...inv,
        lineItems:
          next.length > 0
            ? next
            : [{ id: newId('li_'), service: '', description: '', total: 0 }],
      };
    });

  const biz = businessInfo;
  const initials = (biz.companyName || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="invoice-paper">
      <header className="inv-header">
        <h1 className="inv-title">INVOICE</h1>
        <div className="inv-brand">
          <div className="inv-brand-text">
            <div className="inv-company-name">{biz.companyName || 'Your Company'}</div>
            <div className="inv-tagline">{biz.tagline}</div>
          </div>
          {biz.logo ? (
            <img src={biz.logo} alt="Logo" className="inv-logo" />
          ) : (
            <div className="inv-logo placeholder">{initials}</div>
          )}
        </div>
      </header>

      <div className="inv-separator" />

      <section className="inv-meta">
        <div className="inv-client">
          <div className="inv-label">INVOICE TO :</div>
          <Editable
            initialValue={invoice.client?.name}
            onSave={(v) => updateClient('name', v)}
            placeholder="Client Name"
            className="inv-client-name"
          />
          <div className="inv-client-details">
            <div>
              <span className="prefix">P :</span>{' '}
              <Editable
                initialValue={invoice.client?.phone}
                onSave={(v) => updateClient('phone', v)}
                placeholder="+1 (000) 000-0000"
              />
            </div>
            <div>
              <span className="prefix">E :</span>{' '}
              <Editable
                initialValue={invoice.client?.email}
                onSave={(v) => updateClient('email', v)}
                placeholder="client@email.com"
              />
            </div>
            <div>
              <span className="prefix">A :</span>{' '}
              <Editable
                initialValue={invoice.client?.address}
                onSave={(v) => updateClient('address', v)}
                placeholder="Address"
                multiline
              />
            </div>
          </div>
        </div>

        <div className="inv-total-block">
          <div className="inv-label right">TOTAL DUE</div>
          <div className="inv-total-amount">USD : ${formatCurrency(totalDue)}</div>
          <div className="inv-divider-thin" />
          <div className="inv-doc-meta">
            <div>
              No:{' '}
              <Editable
                initialValue={invoice.invoiceNumber}
                onSave={(v) => updateInvoice({ invoiceNumber: v })}
                placeholder="000000-00000"
              />
            </div>
            <div>
              Date :{' '}
              <Editable
                initialValue={invoice.date}
                onSave={(v) => updateInvoice({ date: v })}
                placeholder="DD/MM/YYYY"
              />
            </div>
          </div>
        </div>
      </section>

      <table className="inv-table">
        <thead>
          <tr>
            <th>SERVICE</th>
            <th>DESCRIPTION</th>
            <th className="amount-col">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="inv-row">
              <td className="cell-service">
                <Editable
                  initialValue={item.service}
                  onSave={(v) => updateLineItem(item.id, 'service', v)}
                  placeholder="Service"
                  multiline
                  className="inv-service-text"
                />
              </td>
              <td className="cell-desc">
                <Editable
                  initialValue={item.description}
                  onSave={(v) => updateLineItem(item.id, 'description', v)}
                  placeholder="Description"
                  multiline
                  className="inv-desc-text"
                />
              </td>
              <td className="cell-amount">
                <span className="amount-wrap">
                  <span className="dollar">$</span>
                  <Editable
                    initialValue={item.total ? String(item.total) : ''}
                    onSave={(v) => updateLineItem(item.id, 'total', v)}
                    placeholder="0"
                    className="inv-amount"
                  />
                </span>
                <button
                  className="remove-row no-print"
                  onClick={() => removeLineItem(item.id)}
                  title="Remove line item"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="add-row no-print" onClick={addLineItem}>
        <Plus size={14} strokeWidth={2.5} /> Add line item
      </button>

      <section className="inv-footer-block">
        <div className="inv-payment">
          <h3>Payment Method :</h3>
          <div className="inv-payment-list">
            <div className="pay-label">Name</div>
            <div className="pay-value">{biz.payment.name || '—'}</div>
            <div className="pay-label">Bank name</div>
            <div className="pay-value">{biz.payment.bankName || '—'}</div>
            <div className="pay-label">Bank address</div>
            <div className="pay-value">{biz.payment.bankAddress || '—'}</div>
            <div className="pay-label">Account number</div>
            <div className="pay-value mono">{biz.payment.accountNumber || '—'}</div>
            <div className="pay-label">Routing number</div>
            <div className="pay-value mono">{biz.payment.routingNumber || '—'}</div>
          </div>
        </div>

        <div className="inv-sig">
          <div className="inv-sig-name">{biz.signatureName || '\u00A0'}</div>
          <div className="inv-sig-line" />
          <div className="inv-sig-title">
            {[biz.signatureTitle, biz.companyName].filter(Boolean).join(', ')}
          </div>
        </div>
      </section>

      <div className="inv-footer-msg">{biz.footerMessage}</div>
    </div>
  );
}

/* ============================================================
   Settings Modal — account + persistent business info
   ============================================================ */
function SettingsModal({ businessInfo, setBusinessInfo, user, onSignOut, onClose }) {
  const fileInputRef = useRef(null);

  const update = (path, value) =>
    setBusinessInfo((prev) => {
      if (path.includes('.')) {
        const [a, b] = path.split('.');
        return { ...prev, [a]: { ...prev[a], [b]: value } };
      }
      return { ...prev, [path]: value };
    });

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 700 * 1024) {
      alert('Logo too large. Please use an image under 700KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update('logo', reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">
          {user && (
            <div className="account-block">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="account-avatar" />
              ) : (
                <div className="account-avatar placeholder">
                  {(user.displayName || user.email || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="account-info">
                <div className="account-name">{user.displayName || 'Signed in'}</div>
                <div className="account-email">{user.email}</div>
              </div>
              <button className="signout-btn" onClick={onSignOut}>
                <LogOut size={13} /> Sign out
              </button>
            </div>
          )}

          <h3 className="section-title">Business info</h3>
          <p className="modal-hint">These details appear on every invoice.</p>

          <div className="setting-row">
            <label>Logo</label>
            <div className="logo-control">
              {businessInfo.logo ? (
                <img src={businessInfo.logo} alt="logo" className="logo-preview" />
              ) : (
                <div className="logo-preview placeholder">
                  <ImageIcon size={20} />
                </div>
              )}
              <div className="logo-actions">
                <button onClick={() => fileInputRef.current?.click()}>
                  <Upload size={13} /> Upload
                </button>
                {businessInfo.logo && (
                  <button onClick={() => update('logo', null)}>Remove</button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="setting-row">
            <label>Company name</label>
            <input
              value={businessInfo.companyName}
              onChange={(e) => update('companyName', e.target.value)}
            />
          </div>
          <div className="setting-row">
            <label>Tagline</label>
            <input
              value={businessInfo.tagline}
              onChange={(e) => update('tagline', e.target.value)}
            />
          </div>

          <h3 className="section-title">Payment details</h3>
          <div className="setting-row">
            <label>Account holder name</label>
            <input
              value={businessInfo.payment.name}
              onChange={(e) => update('payment.name', e.target.value)}
            />
          </div>
          <div className="setting-row">
            <label>Bank name</label>
            <input
              value={businessInfo.payment.bankName}
              onChange={(e) => update('payment.bankName', e.target.value)}
            />
          </div>
          <div className="setting-row">
            <label>Bank address</label>
            <input
              value={businessInfo.payment.bankAddress}
              onChange={(e) => update('payment.bankAddress', e.target.value)}
            />
          </div>
          <div className="two-col">
            <div className="setting-row">
              <label>Account number</label>
              <input
                value={businessInfo.payment.accountNumber}
                onChange={(e) => update('payment.accountNumber', e.target.value)}
              />
            </div>
            <div className="setting-row">
              <label>Routing number</label>
              <input
                value={businessInfo.payment.routingNumber}
                onChange={(e) => update('payment.routingNumber', e.target.value)}
              />
            </div>
          </div>

          <h3 className="section-title">Signature</h3>
          <div className="two-col">
            <div className="setting-row">
              <label>Your name</label>
              <input
                value={businessInfo.signatureName}
                onChange={(e) => update('signatureName', e.target.value)}
              />
            </div>
            <div className="setting-row">
              <label>Title</label>
              <input
                value={businessInfo.signatureTitle}
                onChange={(e) => update('signatureTitle', e.target.value)}
              />
            </div>
          </div>

          <h3 className="section-title">Footer</h3>
          <div className="setting-row">
            <label>Closing message</label>
            <input
              value={businessInfo.footerMessage}
              onChange={(e) => update('footerMessage', e.target.value)}
            />
          </div>
        </div>
        <footer className="modal-footer">
          <button className="tool-btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ============================================================
   Main App
   ============================================================ */
export default function App() {
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'signedOut' | 'signedIn'
  const [user, setUser] = useState(null);

  const [businessInfo, setBusinessInfo] = useState(defaultBusinessInfo);
  const [invoices, setInvoices] = useState([]);
  const [currentInvoiceId, setCurrentInvoiceId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const [bizLoaded, setBizLoaded] = useState(false);
  const [invsLoaded, setInvsLoaded] = useState(false);
  const dataReady = bizLoaded && invsLoaded;

  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const saveTimers = useRef({});

  // ----- Auth state -----
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthStatus(u ? 'signedIn' : 'signedOut');
      if (!u) {
        setInvoices([]);
        setCurrentInvoiceId(null);
        setBusinessInfo(defaultBusinessInfo);
        setBizLoaded(false);
        setInvsLoaded(false);
      }
    });
    return unsub;
  }, []);

  // ----- Online/offline indicator -----
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ----- Firestore subscriptions -----
  useEffect(() => {
    if (!user) return;

    const unsubInvoices = onSnapshot(
      query(invoicesCol(user.uid), orderBy('updatedAt', 'desc')),
      (snap) => {
        const invs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInvoices(invs);
        setInvsLoaded(true);
      },
      (err) => {
        console.error('Invoices subscription error:', err);
        setInvsLoaded(true);
      },
    );

    const unsubBiz = onSnapshot(
      businessInfoDoc(user.uid),
      (snap) => {
        if (snap.exists()) {
          setBusinessInfo({ ...defaultBusinessInfo, ...snap.data() });
        }
        setBizLoaded(true);
      },
      (err) => {
        console.error('Business info subscription error:', err);
        setBizLoaded(true);
      },
    );

    return () => {
      unsubInvoices();
      unsubBiz();
    };
  }, [user]);

  // ----- After initial fetch: pick a current invoice / create blank if empty -----
  useEffect(() => {
    if (!dataReady || !user) return;
    if (invoices.length === 0 && currentInvoiceId === null) {
      const blank = createBlankInvoice([]);
      setInvoices([blank]);
      setCurrentInvoiceId(blank.id);
      setDoc(invoiceDoc(user.uid, blank.id), blank).catch((e) =>
        console.error('Create blank invoice failed:', e),
      );
    } else if (!currentInvoiceId && invoices.length > 0) {
      setCurrentInvoiceId(invoices[0].id);
    }
  }, [dataReady, invoices, currentInvoiceId, user]);

  // ----- Debounced business-info save -----
  useEffect(() => {
    if (!dataReady || !user) return;
    const t = setTimeout(() => {
      setDoc(businessInfoDoc(user.uid), businessInfo).catch((e) =>
        console.error('Save business info failed:', e),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [businessInfo, dataReady, user]);

  // ----- Per-invoice debounced save -----
  const scheduleSave = useCallback(
    (invoice) => {
      if (!user) return;
      if (saveTimers.current[invoice.id]) clearTimeout(saveTimers.current[invoice.id]);
      saveTimers.current[invoice.id] = setTimeout(() => {
        setDoc(invoiceDoc(user.uid, invoice.id), invoice).catch((e) =>
          console.error('Save invoice failed:', e),
        );
      }, 400);
    },
    [user],
  );

  const currentInvoice = invoices.find((i) => i.id === currentInvoiceId);

  const updateInvoice = useCallback(
    (updater) => {
      let updated = null;
      setInvoices((prev) =>
        prev
          .map((inv) => {
            if (inv.id !== currentInvoiceId) return inv;
            const next =
              typeof updater === 'function' ? updater(inv) : { ...inv, ...updater };
            updated = { ...next, updatedAt: Date.now() };
            return updated;
          })
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      );
      if (updated) scheduleSave(updated);
    },
    [currentInvoiceId, scheduleSave],
  );

  const newInvoice = () => {
    if (!user) return;
    const blank = createBlankInvoice(invoices);
    setInvoices((prev) => [blank, ...prev]);
    setCurrentInvoiceId(blank.id);
    setDoc(invoiceDoc(user.uid, blank.id), blank).catch((e) =>
      console.error('Create invoice failed:', e),
    );
  };

  const duplicateInvoice = () => {
    if (!currentInvoice || !user) return;
    const dup = {
      ...currentInvoice,
      id: newId('inv_'),
      invoiceNumber: nextInvoiceNumber(invoices),
      date: formatDate(new Date()),
      lineItems: currentInvoice.lineItems.map((li) => ({ ...li, id: newId('li_') })),
      updatedAt: Date.now(),
    };
    setInvoices((prev) => [dup, ...prev]);
    setCurrentInvoiceId(dup.id);
    setDoc(invoiceDoc(user.uid, dup.id), dup).catch((e) =>
      console.error('Duplicate failed:', e),
    );
  };

  const deleteInvoice = (id) => {
    if (!user) return;
    if (!confirm('Delete this invoice? This cannot be undone.')) return;

    if (saveTimers.current[id]) {
      clearTimeout(saveTimers.current[id]);
      delete saveTimers.current[id];
    }

    setInvoices((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (id === currentInvoiceId) {
        setCurrentInvoiceId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });

    deleteDoc(invoiceDoc(user.uid, id)).catch((e) =>
      console.error('Delete failed:', e),
    );
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Sign out failed:', e);
    }
  };

  const downloadPDF = () => {
    window.print();
  };

  // ----- Render guards -----
  if (authStatus === 'loading') {
    return (
      <>
        <FontsLink />
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
        <style>{globalStyles}</style>
      </>
    );
  }

  if (authStatus === 'signedOut') {
    return (
      <>
        <FontsLink />
        <SignInScreen />
        <style>{globalStyles}</style>
      </>
    );
  }

  if (!dataReady || !currentInvoice) {
    return (
      <>
        <FontsLink />
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
        <style>{globalStyles}</style>
      </>
    );
  }

  const totalDue = sumLineItems(currentInvoice.lineItems);

  return (
    <>
      <FontsLink />

      <div className="app">
        {/* Sidebar */}
        <aside className="sidebar no-print">
          <div className="sidebar-header">
            <div className="brand">
              <div className="brand-mark">
                <FileText size={14} strokeWidth={2.5} />
              </div>
              <span>Invoices</span>
            </div>
            <div className="header-actions">
              <div
                className={`sync-pill ${online ? 'online' : 'offline'}`}
                title={online ? 'Synced to cloud' : 'Offline — changes will sync when reconnected'}
              >
                {online ? <Cloud size={12} /> : <CloudOff size={12} />}
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                <Settings size={15} />
              </button>
            </div>
          </div>

          <button className="new-btn" onClick={newInvoice}>
            <FilePlus2 size={15} strokeWidth={2.25} /> New invoice
          </button>

          <div className="invoice-list">
            {invoices.length === 0 && <div className="empty">No invoices yet</div>}
            {invoices.map((inv) => {
              const t = sumLineItems(inv.lineItems);
              return (
                <div
                  key={inv.id}
                  className={`invoice-item ${inv.id === currentInvoiceId ? 'active' : ''}`}
                  onClick={() => setCurrentInvoiceId(inv.id)}
                >
                  <div className="invoice-item-main">
                    <div className="invoice-item-client">
                      {inv.client?.name || 'Untitled invoice'}
                    </div>
                    <div className="invoice-item-num">
                      {inv.invoiceNumber || 'No number'} · {inv.date}
                    </div>
                  </div>
                  <div className="invoice-item-meta">
                    <div className="invoice-item-amount">${formatCurrency(t)}</div>
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteInvoice(inv.id);
                      }}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sidebar-footer">
            <button
              className="user-chip"
              onClick={() => setShowSettings(true)}
              title="Account & settings"
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" />
              ) : (
                <div className="user-chip-fallback">
                  {(user?.displayName || user?.email || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="user-chip-text">
                <div className="user-chip-name">{user?.displayName || 'You'}</div>
                <div className="user-chip-email">{user?.email}</div>
              </div>
            </button>
          </div>
        </aside>

        {/* Workspace */}
        <main className="workspace">
          <div className="toolbar no-print">
            <div className="toolbar-left">
              <span className="toolbar-tag">Editing</span>
              <span className="toolbar-label">
                {currentInvoice.invoiceNumber}
                {currentInvoice.client?.name ? ` · ${currentInvoice.client.name}` : ''}
              </span>
            </div>
            <div className="toolbar-actions">
              <button className="tool-btn" onClick={duplicateInvoice}>
                <Copy size={14} strokeWidth={2.25} /> Duplicate
              </button>
              <button className="tool-btn primary" onClick={downloadPDF}>
                <Download size={14} strokeWidth={2.25} /> Download PDF
              </button>
            </div>
          </div>

          <InvoicePaper
            invoice={currentInvoice}
            businessInfo={businessInfo}
            totalDue={totalDue}
            updateInvoice={updateInvoice}
          />

          <div className="workspace-spacer" />
        </main>

        {showSettings && (
          <SettingsModal
            businessInfo={businessInfo}
            setBusinessInfo={setBusinessInfo}
            user={user}
            onSignOut={handleSignOut}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>

      <style>{globalStyles}</style>
    </>
  );
}

function FontsLink() {
  return (
    <link
      href="https://fonts.googleapis.com/css2?family=Onest:wght@300..900&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  );
}

/* ============================================================
   Styles
   ============================================================ */
const globalStyles = `
  * { box-sizing: border-box; }

  html, body, #root { height: 100%; margin: 0; }

  body {
    font-family: 'Onest', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #E8E2D4;
    color: #141414;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .app {
    display: flex;
    height: 100vh;
    background: #E8E2D4;
    overflow: hidden;
  }

  /* Loading */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 6px;
    background: #E8E2D4;
  }
  .loading-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: rgba(0,0,0,0.4);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .loading-dot:nth-child(2) { animation-delay: 0.15s; }
  .loading-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  /* Sign-in */
  .signin-page {
    min-height: 100vh;
    background: #E8E2D4;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: 'Onest', sans-serif;
  }
  .signin-card {
    background: white;
    padding: 44px 40px 32px;
    border-radius: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    max-width: 380px;
    width: 100%;
    text-align: center;
  }
  .signin-mark {
    width: 44px;
    height: 44px;
    background: #141414;
    color: white;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 22px;
  }
  .signin-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.025em;
    margin: 0 0 10px;
    line-height: 1.15;
  }
  .signin-sub {
    font-size: 14px;
    color: rgba(0,0,0,0.62);
    line-height: 1.5;
    margin: 0 0 26px;
  }
  .google-btn {
    width: 100%;
    background: white;
    color: #141414;
    border: 1px solid rgba(0,0,0,0.18);
    padding: 11px 16px;
    border-radius: 10px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: border-color 0.15s, transform 0.1s;
  }
  .google-btn:hover:not(:disabled) { border-color: rgba(0,0,0,0.4); }
  .google-btn:active:not(:disabled) { transform: scale(0.985); }
  .google-btn:disabled { opacity: 0.6; cursor: default; }
  .signin-error {
    margin-top: 14px;
    font-size: 12.5px;
    color: #b91c1c;
    background: #fef2f2;
    padding: 8px 12px;
    border-radius: 7px;
    line-height: 1.4;
  }
  .signin-foot {
    margin-top: 22px;
    font-size: 11.5px;
    color: rgba(0,0,0,0.45);
  }

  /* Sidebar */
  .sidebar {
    width: 280px;
    background: #F2EDE2;
    border-right: 1px solid rgba(0,0,0,0.08);
    display: flex;
    flex-direction: column;
    padding: 18px 14px 14px;
    gap: 14px;
    flex-shrink: 0;
  }
  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: 14px;
  }
  .brand-mark {
    width: 22px; height: 22px;
    background: #141414;
    color: white;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sync-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: rgba(0,0,0,0.45);
    transition: color 0.15s, background 0.15s;
  }
  .sync-pill.online { color: #15803d; }
  .sync-pill.offline { color: #b45309; background: rgba(180,83,9,0.08); }
  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    color: #141414;
    transition: background 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover { background: rgba(0,0,0,0.06); }
  .new-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #141414;
    color: white;
    border: none;
    padding: 11px 14px;
    border-radius: 9px;
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: transform 0.1s, opacity 0.15s;
  }
  .new-btn:hover { opacity: 0.92; }
  .new-btn:active { transform: scale(0.985); }
  .invoice-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -4px;
    padding: 0 4px;
  }
  .empty {
    text-align: center;
    color: rgba(0,0,0,0.4);
    font-size: 13px;
    padding: 40px 16px;
  }
  .invoice-item {
    padding: 10px 11px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: background 0.12s;
    gap: 8px;
  }
  .invoice-item:hover { background: rgba(0,0,0,0.045); }
  .invoice-item.active { background: rgba(0,0,0,0.085); }
  .invoice-item-main { flex: 1; min-width: 0; }
  .invoice-item-client {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .invoice-item-num {
    font-size: 11px;
    color: rgba(0,0,0,0.5);
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .invoice-item-meta {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .invoice-item-amount {
    font-size: 12.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .delete-btn {
    background: transparent;
    border: none;
    padding: 5px;
    border-radius: 5px;
    cursor: pointer;
    color: rgba(0,0,0,0.4);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    display: flex;
  }
  .invoice-item:hover .delete-btn { opacity: 1; }
  .delete-btn:hover { background: rgba(200,30,30,0.1); color: #c01919; }

  .sidebar-footer {
    border-top: 1px solid rgba(0,0,0,0.08);
    padding-top: 10px;
  }
  .user-chip {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    padding: 8px 10px;
    border-radius: 9px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: background 0.15s, border-color 0.15s;
    text-align: left;
    font-family: inherit;
    color: #141414;
  }
  .user-chip:hover { background: rgba(0,0,0,0.045); }
  .user-chip img, .user-chip-fallback {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
  }
  .user-chip-fallback {
    background: #141414;
    color: white;
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .user-chip-text { min-width: 0; flex: 1; }
  .user-chip-name {
    font-size: 12.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }
  .user-chip-email {
    font-size: 11px;
    color: rgba(0,0,0,0.55);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Workspace */
  .workspace {
    flex: 1;
    overflow-y: auto;
    padding: 22px 24px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .workspace-spacer { height: 40px; flex-shrink: 0; }
  .toolbar {
    width: 794px;
    max-width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    padding: 0 2px;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .toolbar-tag {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 7px;
    background: rgba(0,0,0,0.07);
    border-radius: 4px;
    color: rgba(0,0,0,0.6);
  }
  .toolbar-label {
    font-size: 13px;
    color: rgba(0,0,0,0.65);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .toolbar-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .tool-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: white;
    border: 1px solid rgba(0,0,0,0.13);
    padding: 8px 13px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    color: #141414;
    transition: border-color 0.15s, transform 0.1s;
  }
  .tool-btn:hover { border-color: rgba(0,0,0,0.32); }
  .tool-btn:active { transform: scale(0.98); }
  .tool-btn.primary {
    background: #141414;
    color: white;
    border-color: #141414;
  }
  .tool-btn.primary:hover { opacity: 0.9; border-color: #141414; }

  /* Invoice Paper */
  .invoice-paper {
    width: 794px;
    max-width: 100%;
    background: white;
    box-shadow: 0 8px 30px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    padding: 64px;
    color: #141414;
    border-radius: 3px;
    font-size: 14px;
    line-height: 1.5;
  }
  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
  }
  .inv-title {
    font-size: 60px;
    font-weight: 900;
    letter-spacing: -0.04em;
    margin: 0;
    line-height: 0.95;
    color: #0a0a0a;
  }
  .inv-brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-top: 8px;
  }
  .inv-brand-text { text-align: right; }
  .inv-company-name {
    font-size: 19px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .inv-tagline {
    font-size: 10.5px;
    color: rgba(0,0,0,0.7);
    max-width: 210px;
    line-height: 1.45;
    margin-top: 2px;
  }
  .inv-logo {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    background: #141414;
    flex-shrink: 0;
  }
  .inv-logo.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 800;
    font-size: 15px;
    letter-spacing: 0.02em;
  }
  .inv-separator {
    height: 1px;
    background: rgba(0,0,0,0.18);
    margin: 22px 0 34px;
  }
  .inv-meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 30px;
    margin-bottom: 30px;
  }
  .inv-client { flex: 1; min-width: 0; }
  .inv-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.09em;
    color: #141414;
    margin-bottom: 8px;
  }
  .inv-label.right { text-align: right; }
  .inv-client-name {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.025em;
    display: block;
    margin-bottom: 14px;
    line-height: 1.1;
  }
  .inv-client-details {
    font-size: 13px;
    color: rgba(0,0,0,0.78);
    display: flex;
    flex-direction: column;
    gap: 3px;
    line-height: 1.55;
  }
  .inv-client-details .prefix {
    display: inline-block;
    width: 18px;
    color: rgba(0,0,0,0.55);
  }
  .inv-total-block {
    text-align: right;
    min-width: 220px;
    flex-shrink: 0;
  }
  .inv-total-amount {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin-bottom: 16px;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .inv-divider-thin {
    width: 42px;
    height: 2px;
    background: rgba(0,0,0,0.4);
    margin-left: auto;
    margin-bottom: 12px;
  }
  .inv-doc-meta {
    font-size: 12px;
    color: rgba(0,0,0,0.7);
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-variant-numeric: tabular-nums;
  }
  .inv-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6px;
    table-layout: fixed;
  }
  .inv-table thead th {
    background: #141414;
    color: white;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.09em;
    padding: 13px 18px;
    text-align: left;
  }
  .inv-table thead th.amount-col { text-align: right; width: 150px; }
  .inv-table thead th:first-child { width: 220px; }
  .inv-table td {
    border: 1px solid rgba(0,0,0,0.18);
    padding: 16px 18px;
    vertical-align: middle;
    font-size: 13.5px;
    line-height: 1.55;
  }
  .cell-service { text-align: center; }
  .cell-service .inv-service-text {
    font-size: 14.5px;
    font-weight: 500;
    text-align: center;
    display: block;
  }
  .cell-desc .inv-desc-text {
    font-size: 13px;
    line-height: 1.6;
    display: block;
  }
  .cell-amount {
    text-align: right;
    font-size: 14.5px;
    font-weight: 500;
    white-space: nowrap;
    position: relative;
    font-variant-numeric: tabular-nums;
    vertical-align: middle;
  }
  .amount-wrap {
    display: inline-flex;
    align-items: baseline;
  }
  .cell-amount .dollar { margin-right: 1px; }
  .inv-amount {
    display: inline-block;
    min-width: 24px;
    text-align: right;
  }
  .remove-row {
    position: absolute;
    left: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: white;
    border: 1px solid rgba(0,0,0,0.18);
    border-radius: 50%;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
    color: rgba(0,0,0,0.5);
  }
  .inv-row:hover .remove-row { opacity: 1; }
  .remove-row:hover { color: #c01919; border-color: #c01919; }
  .add-row {
    margin-top: 12px;
    background: transparent;
    border: 1px dashed rgba(0,0,0,0.22);
    padding: 9px 14px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    color: rgba(0,0,0,0.55);
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .add-row:hover { border-color: rgba(0,0,0,0.45); color: #141414; }
  .inv-footer-block {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-top: 38px;
    gap: 32px;
  }
  .inv-payment h3 {
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin: 0 0 14px;
  }
  .inv-payment-list {
    display: grid;
    grid-template-columns: 1fr;
    font-size: 13px;
    line-height: 1.55;
  }
  .pay-label { color: rgba(0,0,0,0.7); margin-top: 4px; }
  .pay-value { font-weight: 500; }
  .pay-value.mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0;
  }
  .inv-sig {
    align-self: end;
    text-align: center;
    padding-top: 40px;
  }
  .inv-sig-name {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin-bottom: 6px;
    min-height: 28px;
  }
  .inv-sig-line {
    height: 1px;
    background: #141414;
    width: 230px;
    margin: 0 auto;
  }
  .inv-sig-title {
    font-size: 12px;
    color: rgba(0,0,0,0.7);
    margin-top: 8px;
  }
  .inv-footer-msg {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin-top: 50px;
  }

  /* Editable */
  .editable {
    outline: none;
    min-width: 4px;
    padding: 1px 4px;
    margin: -1px -4px;
    border-radius: 3px;
    transition: background 0.1s, box-shadow 0.1s;
    cursor: text;
    white-space: pre-wrap;
  }
  .editable:hover { background: rgba(0,0,0,0.035); }
  .editable:focus {
    background: #FFF6D6;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.18);
  }
  .editable:empty::before {
    content: attr(data-placeholder);
    color: rgba(0,0,0,0.28);
    pointer-events: none;
  }

  /* Settings Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20,20,20,0.45);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(3px);
  }
  .modal {
    background: white;
    border-radius: 14px;
    max-width: 540px;
    width: 100%;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(0,0,0,0.35);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 22px;
    border-bottom: 1px solid rgba(0,0,0,0.08);
  }
  .modal-header h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.015em;
  }
  .modal-body {
    padding: 20px 22px 8px;
    overflow-y: auto;
    flex: 1;
  }
  .modal-hint {
    font-size: 13px;
    color: rgba(0,0,0,0.6);
    margin: 0 0 18px;
    line-height: 1.5;
  }
  .modal-footer {
    padding: 14px 22px;
    border-top: 1px solid rgba(0,0,0,0.08);
    display: flex;
    justify-content: flex-end;
  }
  .account-block {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: #FAF7F0;
    border-radius: 10px;
    margin-bottom: 20px;
  }
  .account-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .account-avatar.placeholder {
    background: #141414;
    color: white;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .account-info { flex: 1; min-width: 0; }
  .account-name {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account-email {
    font-size: 12px;
    color: rgba(0,0,0,0.6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .signout-btn {
    background: white;
    border: 1px solid rgba(0,0,0,0.15);
    padding: 6px 11px;
    border-radius: 7px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
    color: #141414;
    transition: border-color 0.15s;
    flex-shrink: 0;
  }
  .signout-btn:hover { border-color: rgba(0,0,0,0.32); }
  .section-title {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin: 22px 0 10px;
    color: rgba(0,0,0,0.55);
  }
  .section-title:first-child { margin-top: 0; }
  .setting-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 11px;
  }
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 11px;
  }
  .setting-row label {
    font-size: 12.5px;
    font-weight: 600;
    color: rgba(0,0,0,0.72);
  }
  .setting-row input {
    font-family: inherit;
    font-size: 13.5px;
    padding: 8px 11px;
    border: 1px solid rgba(0,0,0,0.15);
    border-radius: 7px;
    outline: none;
    transition: border-color 0.15s;
    background: white;
    color: #141414;
  }
  .setting-row input:focus { border-color: #141414; }
  .logo-control {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo-preview {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    object-fit: cover;
    background: #141414;
    flex-shrink: 0;
  }
  .logo-preview.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.55);
  }
  .logo-actions {
    display: flex;
    gap: 6px;
  }
  .logo-actions button {
    background: white;
    border: 1px solid rgba(0,0,0,0.15);
    padding: 6px 11px;
    border-radius: 7px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 5px;
    color: #141414;
    transition: border-color 0.15s;
  }
  .logo-actions button:hover { border-color: rgba(0,0,0,0.3); }

  /* Print */
  @media print {
    @page {
      size: A4;
      margin: 0;
    }
    body, html {
      background: white !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .no-print, .no-print * { display: none !important; }
    .app {
      display: block !important;
      background: white !important;
      height: auto !important;
      overflow: visible !important;
    }
    .workspace {
      padding: 0 !important;
      overflow: visible !important;
      align-items: flex-start !important;
    }
    .invoice-paper {
      width: 210mm !important;
      max-width: none !important;
      box-shadow: none !important;
      padding: 18mm !important;
      border-radius: 0 !important;
      page-break-inside: avoid;
    }
    .editable {
      background: transparent !important;
      box-shadow: none !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .editable:empty::before { content: '' !important; }
    .remove-row, .add-row { display: none !important; }
  }
`;
