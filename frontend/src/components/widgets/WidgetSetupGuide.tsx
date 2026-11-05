import { Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiBaseUrl } from '../../api/client';
import {
  SHORTCUT_NAMES,
  WidgetAction,
  appBaseUrl,
  fillScriptConfig,
  kwgtFormulas,
  quickLinkUrl,
  shortcutBody,
  widgetReadUrl,
} from '../../lib/widgetSetup';
import { toast } from '../../lib/toast';
import { WalletBalance, WidgetToken } from '../../types';
import { Icon } from '../Icon';
import { Alert, Button, Segmented } from '../ui';
import { ACTION_LABEL } from './WidgetTokenForm';
import { CopyField, copyText } from './CopyField';

type Platform = 'ios' | 'android';

const SCRIPT_PATH = 'widgets/ios/QuickWallet.scriptable.js';
const PARAM_EXAMPLES = [
  'layout=small-total',
  'layout=small-wallets',
  'layout=medium-grid',
  'layout=medium-list',
  'layout=large',
  'layout=medium-grid; buttons=shortcut',
];

/**
 * Ready-to-use setup for one token, iPhone or Android, with the URLs and the
 * token filled in. Without the secret (it is only known right after creation
 * or regeneration) the token appears as a placeholder.
 */
export function WidgetSetupGuide({
  token,
  secret,
  wallets,
}: {
  token: WidgetToken;
  secret: string | null;
  wallets: WalletBalance[];
}) {
  const { t, i18n } = useTranslation();
  const [platform, setPlatform] = useState<Platform>(() =>
    typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) ? 'android' : 'ios',
  );
  const [loadingScript, setLoadingScript] = useState(false);

  const api = apiBaseUrl() || 'https://script.google.com/macros/s/…/exec';
  const app = appBaseUrl(window.location.href);
  const shownSecret = secret ?? t('widgets.tokenPlaceholder');
  const lang = i18n.resolvedLanguage === 'th' ? 'th' : 'en';
  const writable = token.scope === 'readwrite';
  const actions = writable ? token.allowedActions : (['expense', 'income', 'transfer'] as WidgetAction[]);
  const writeWallets = wallets.filter((w) => token.writeWalletIds.includes(w.id));
  const bodyFor = (type: WidgetAction, placeholders: { amount: string; walletId: string; toWalletId: string; note: string; clientId: string }) =>
    shortcutBody(shownSecret, type, placeholders);

  async function copyScript() {
    setLoadingScript(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${SCRIPT_PATH}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(String(response.status));
      const filled = fillScriptConfig(await response.text(), apiBaseUrl(), app);
      if (await copyText(filled)) toast.success(t('widgets.scriptCopied'));
      else toast.error(t('widgets.copyFailed'));
    } catch {
      toast.error(t('widgets.scriptLoadFailed'));
    } finally {
      setLoadingScript(false);
    }
  }

  return (
    <div className="widget-guide">
      <Segmented<Platform>
        value={platform}
        onChange={setPlatform}
        ariaLabel={t('widgets.platform')}
        options={[
          { value: 'ios', label: t('widgets.iphone') },
          { value: 'android', label: t('widgets.android') },
        ]}
      />

      {platform === 'ios' ? (
        <ol className="widget-steps">
          <li>
            <strong>{t('widgets.iosStep1')}</strong>
            <span>{t('widgets.iosStep1Body')}</span>
          </li>
          <li>
            <strong>{t('widgets.iosStep2')}</strong>
            <span>{t('widgets.iosStep2Body')}</span>
            <Button size="sm" onClick={() => void copyScript()} loading={loadingScript}>
              <Icon icon={Copy} size="sm" />
              {t('widgets.copyScript')}
            </Button>
          </li>
          <li>
            <strong>{t('widgets.iosStep3')}</strong>
            <span>{t('widgets.iosStep3Body')}</span>
            {secret && <CopyField label={t('widgets.token')} value={secret} secret />}
          </li>
          <li>
            <strong>{t('widgets.iosStep4')}</strong>
            <span>{t('widgets.iosStep4Body')}</span>
            <div className="widget-copy-grid">
              {PARAM_EXAMPLES.map((param) => (
                <CopyField key={param} value={`${param}; lang=${lang}`} />
              ))}
            </div>
            <span className="field-hint">{t('widgets.iosLockScreen')}</span>
          </li>
          <li>
            <strong>{t('widgets.iosStep5')}</strong>
            <span>{t('widgets.iosStep5Body')}</span>
          </li>
          {writable && (
            <li>
              <strong>{t('widgets.iosStep6')}</strong>
              <span>{t('widgets.iosStep6Body')}</span>
              <CopyField label={t('widgets.requestUrl')} value={api} />
              {actions.map((type) => (
                <CopyField
                  key={type}
                  label={`${SHORTCUT_NAMES[type]} · ${t(ACTION_LABEL[type])}`}
                  value={bodyFor(type, {
                    amount: t('widgets.phAmount'),
                    walletId: t('widgets.phWallet'),
                    toWalletId: t('widgets.phToWallet'),
                    note: t('widgets.phNote'),
                    clientId: t('widgets.phUuid'),
                  })}
                  multiline
                />
              ))}
              <WalletIds wallets={writeWallets} />
            </li>
          )}
        </ol>
      ) : (
        <ol className="widget-steps">
          <li>
            <strong>{t('widgets.androidStep1')}</strong>
            <span>{t('widgets.androidStep1Body')}</span>
          </li>
          <li>
            <strong>{t('widgets.androidStep2')}</strong>
            <span>{t('widgets.androidStep2Body')}</span>
            <CopyField label="url" value={widgetReadUrl(api, shownSecret, lang)} secret={Boolean(secret)} />
          </li>
          <li>
            <strong>{t('widgets.androidStep3')}</strong>
            <span>{t('widgets.androidStep3Body')}</span>
            <div className="widget-copy-grid">
              {kwgtFormulas(4).map((f) => (
                <CopyField key={f.id} label={f.id} value={f.formula} />
              ))}
            </div>
            <Alert tone="warning">{t('widgets.kwgtRedirect')}</Alert>
          </li>
          <li>
            <strong>{t('widgets.androidStep4')}</strong>
            <span>{t('widgets.androidStep4Body')}</span>
            {(['expense', 'income', 'transfer'] as WidgetAction[]).map((type) => (
              <CopyField key={type} label={t(ACTION_LABEL[type])} value={quickLinkUrl(app, type)} />
            ))}
          </li>
          <li>
            <strong>{t('widgets.androidStep5')}</strong>
            <span>{t('widgets.androidStep5Body')}</span>
          </li>
          {writable && (
            <li>
              <strong>{t('widgets.androidStep6')}</strong>
              <span>{t('widgets.androidStep6Body')}</span>
              <CopyField label={t('widgets.requestUrl')} value={api} />
              {actions.map((type) => (
                <CopyField
                  key={type}
                  label={t(ACTION_LABEL[type])}
                  value={bodyFor(type, {
                    amount: '{amount}',
                    walletId: '{wallet}',
                    toWalletId: '{toWallet}',
                    note: '{note}',
                    clientId: '{uuid}',
                  })}
                  multiline
                />
              ))}
              <WalletIds wallets={writeWallets} />
            </li>
          )}
        </ol>
      )}

      <p className="field-hint">{t('widgets.guideMore')}</p>
    </div>
  );
}

/** The ids the shortcut's wallet list needs, one copy button each. */
function WalletIds({ wallets }: { wallets: WalletBalance[] }) {
  const { t } = useTranslation();
  if (!wallets.length) return null;
  return (
    <div className="widget-copy-grid">
      <span className="copy-field-label">{t('widgets.walletIds')}</span>
      {wallets.map((w) => (
        <CopyField key={w.id} label={w.name} value={w.id} />
      ))}
    </div>
  );
}
