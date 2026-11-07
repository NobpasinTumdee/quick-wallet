import { Ban, KeyRound, Pencil, Plus, RefreshCw, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { Alert, Badge, Button, Card, EmptyState, Modal, RefreshButton } from '../components/ui';
import { CopyField } from '../components/widgets/CopyField';
import { WidgetSetupGuide } from '../components/widgets/WidgetSetupGuide';
import { WidgetTokenForm } from '../components/widgets/WidgetTokenForm';
import { ApiError } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import { useWallets } from '../hooks/useWallets';
import { useWidgetTokens } from '../hooks/useWidgetTokens';
import { cx } from '../lib/format';
import { toast } from '../lib/toast';
import { useSettings } from '../state/SettingsContext';
import { WidgetToken, WidgetTokenPayload, WidgetTokenSecret } from '../types';
import { ListRegionSkeleton } from '../components/skeleton/pageSkeletons';

const MAX_ACTIVE = 10;

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

/**
 * Settings → Widgets & shortcuts. The tokens a phone widget or shortcut uses
 * to read balances (and, for a read + write token, add a record), and the
 * setup steps for iPhone and Android with everything filled in.
 */
export default function WidgetsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const tokens = useWidgetTokens();
  const wallets = useWallets();
  const live = wallets.items.filter((w) => !w.archived);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WidgetToken | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** The one moment a secret is known: right after create or regenerate. */
  const [revealed, setRevealed] = useState<WidgetTokenSecret | null>(null);
  const [guideFor, setGuideFor] = useState<WidgetToken | null>(null);

  const confirmRevoke = useConfirm<WidgetToken>();
  const confirmRegenerate = useConfirm<WidgetToken>();

  const active = tokens.items.filter((x) => x.status === 'active');
  const inactive = tokens.items.filter((x) => x.status !== 'active');
  const outdatedBackend = tokens.errorCode === 'UNKNOWN_ACTION';

  const walletName = (id: string) => wallets.items.find((w) => w.id === id)?.name ?? t('widgets.walletGone');
  const when = (iso: string) =>
    iso
      ? new Date(iso).toLocaleString(settings.locale, { dateStyle: 'medium', timeStyle: 'short' })
      : t('widgets.never');

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(token: WidgetToken) {
    setEditing(token);
    setFormError(null);
    setFormOpen(true);
  }

  async function submit(payload: WidgetTokenPayload) {
    setFormError(null);
    try {
      if (editing) {
        await tokens.update(editing.id, payload);
        setFormOpen(false);
      } else {
        const created = await tokens.create(payload);
        setFormOpen(false);
        setRevealed(created);
      }
    } catch (error) {
      setFormError(errorText(error, t('widgets.saveFailed')));
    }
  }

  return (
    <div className="stack widgets-page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">{t('nav.settings')}</span>
          <h1 className="page-title">{t('widgets.title')}</h1>
          <p className="page-lede">{t('widgets.lede')}</p>
        </div>
        <div className="cluster">
          <RefreshButton onRefresh={tokens.refresh} busy={tokens.isValidating} label={t('widgets.refresh')} />
          <Button
            variant="primary"
            onClick={openCreate}
            disabled={outdatedBackend || active.length >= MAX_ACTIVE || !live.length}
          >
            <Icon icon={Plus} size="sm" />
            {t('widgets.newToken')}
          </Button>
        </div>
      </div>

      <Card title={t('widgets.howTitle')}>
        <div className="widget-how">
          <div>
            <Badge tone="neutral">{t('widgets.scopeRead')}</Badge>
            <p>{t('widgets.howRead')}</p>
          </div>
          <div>
            <Badge tone="warning">{t('widgets.scopeReadWrite')}</Badge>
            <p>{t('widgets.howWrite')}</p>
          </div>
          <p className="field-hint">{t('widgets.howLimits')}</p>
        </div>
      </Card>

      {outdatedBackend && (
        <Alert tone="warning" title={t('widgets.outdatedTitle')}>
          {t('widgets.outdatedBody')}
        </Alert>
      )}
      {tokens.error && !outdatedBackend && <Alert tone="error">{tokens.error}</Alert>}

      <Card
        title={t('widgets.tokensTitle')}
        subtitle={t('widgets.tokensCount', { count: active.length, max: MAX_ACTIVE })}
      >
        {tokens.initialLoading ? (
          <ListRegionSkeleton page="widgets" rows={2} />
        ) : !tokens.items.length ? (
          <EmptyState
            icon={<Icon icon={Smartphone} size="xl" />}
            title={t('widgets.emptyTitle')}
            description={t('widgets.emptyBody')}
          />
        ) : (
          <ul className="widget-tokens">
            {[...active, ...inactive].map((token) => (
              <li key={token.id} className={cx('widget-token', token.status !== 'active' && 'is-inactive')}>
                <div className="widget-token-head">
                  <Icon icon={KeyRound} size="sm" />
                  <strong className="widget-token-name">{token.name}</strong>
                  <Badge tone={token.scope === 'readwrite' ? 'warning' : 'neutral'}>
                    {t(token.scope === 'readwrite' ? 'widgets.scopeReadWrite' : 'widgets.scopeRead')}
                  </Badge>
                  {token.status !== 'active' && (
                    <Badge tone="negative">
                      {t(token.status === 'revoked' ? 'widgets.statusRevoked' : 'widgets.statusExpired')}
                    </Badge>
                  )}
                </div>
                <dl className="widget-token-meta">
                  <div>
                    <dt>{t('widgets.prefix')}</dt>
                    <dd>
                      <code>{token.prefix}…</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('widgets.showWallets')}</dt>
                    <dd>
                      {token.walletIds.length
                        ? token.walletIds.map(walletName).join(', ')
                        : t('widgets.totalOnly')}
                    </dd>
                  </div>
                  {token.scope === 'readwrite' && (
                    <div>
                      <dt>{t('widgets.writeWallets')}</dt>
                      <dd>{token.writeWalletIds.map(walletName).join(', ')}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('widgets.lastUsed')}</dt>
                    <dd>{when(token.lastUsedAt)}</dd>
                  </div>
                  <div>
                    <dt>{t('widgets.expiry')}</dt>
                    <dd>{token.expiresAt ? when(token.expiresAt) : t('widgets.expiryNever')}</dd>
                  </div>
                </dl>
                {token.status !== 'revoked' && (
                  <div className="widget-token-actions">
                    {token.status === 'active' && (
                      <Button size="sm" onClick={() => setGuideFor(token)}>
                        <Icon icon={Smartphone} size="sm" />
                        {t('widgets.setup')}
                      </Button>
                    )}
                    <Button size="sm" onClick={() => openEdit(token)}>
                      <Icon icon={Pencil} size="sm" />
                      {t('common.edit')}
                    </Button>
                    {token.status === 'active' && (
                      <Button size="sm" onClick={() => confirmRegenerate.ask(token)}>
                        <Icon icon={RefreshCw} size="sm" />
                        {t('widgets.regenerate')}
                      </Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => confirmRevoke.ask(token)}>
                      <Icon icon={Ban} size="sm" />
                      {t('widgets.revoke')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <WidgetTokenForm
        open={formOpen}
        token={editing}
        wallets={live}
        busy={tokens.busy}
        error={formError}
        onClose={() => setFormOpen(false)}
        onSubmit={(payload) => void submit(payload)}
      />

      {/* Shown once. Closing it is the last time this secret is on screen. */}
      <Modal
        open={revealed !== null}
        title={t('widgets.revealTitle')}
        onClose={() => setRevealed(null)}
        width={640}
        footer={
          <div className="form-actions">
            <Button variant="primary" onClick={() => setRevealed(null)}>
              {t('widgets.revealDone')}
            </Button>
          </div>
        }
      >
        {revealed && (
          <div className="stack">
            <Alert tone="warning" title={t('widgets.revealWarningTitle')}>
              {t(revealed.token.scope === 'readwrite' ? 'widgets.revealWarningWrite' : 'widgets.revealWarningRead')}
            </Alert>
            <CopyField label={t('widgets.token')} value={revealed.secret} secret />
            <WidgetSetupGuide token={revealed.token} secret={revealed.secret} wallets={live} />
          </div>
        )}
      </Modal>

      <Modal
        open={guideFor !== null}
        title={guideFor ? t('widgets.setupTitle', { name: guideFor.name }) : ''}
        onClose={() => setGuideFor(null)}
        width={640}
      >
        {guideFor && (
          <div className="stack">
            <Alert tone="info">{t('widgets.setupNoSecret')}</Alert>
            <WidgetSetupGuide token={guideFor} secret={null} wallets={live} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmRevoke.open}
        busy={confirmRevoke.busy}
        title={t('widgets.revokeTitle')}
        body={
          <>
            <strong className="confirm-subject">{confirmRevoke.subject?.name}</strong>
            {t('widgets.revokeBody')}
          </>
        }
        confirmLabel={t('widgets.revoke')}
        onConfirm={() =>
          void confirmRevoke.run(async (token) => {
            try {
              await tokens.revoke(token.id);
            } catch (error) {
              toastError(error);
            }
          })
        }
        onClose={confirmRevoke.cancel}
      />

      <ConfirmDialog
        open={confirmRegenerate.open}
        busy={confirmRegenerate.busy}
        tone="primary"
        title={t('widgets.regenerateTitle')}
        body={
          <>
            <strong className="confirm-subject">{confirmRegenerate.subject?.name}</strong>
            {t('widgets.regenerateBody')}
          </>
        }
        confirmLabel={t('widgets.regenerate')}
        onConfirm={() =>
          void confirmRegenerate.run(async (token) => {
            try {
              setRevealed(await tokens.regenerate(token.id));
            } catch (error) {
              toastError(error);
            }
          })
        }
        onClose={confirmRegenerate.cancel}
      />
    </div>
  );

  function toastError(error: unknown) {
    toast.error(errorText(error, t('widgets.saveFailed')));
  }
}
