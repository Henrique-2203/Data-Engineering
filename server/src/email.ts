import { appendFileSync } from 'node:fs';
import { config } from './config.ts';

/**
 * E-mails de segurança (confirmar e-mail, código para trocar a senha, alertas de novo acesso).
 *
 * Provedores (variável EMAIL_PROVIDER):
 * - "brevo":  300 e-mails/dia grátis, aceita remetente verificado sem domínio próprio (EMAIL_API_KEY, EMAIL_FROM)
 * - "resend": 3.000/mês grátis, precisa de domínio próprio verificado
 * - "file":   grava num arquivo (EMAIL_OUTBOX), usado nos testes
 * Sem provedor, as funções de e-mail ficam escondidas no site.
 *
 * Regras anti-golpe: os e-mails NUNCA têm link para "entrar" nem pedem senha. Só códigos para digitar
 * no próprio Resenha e avisos do que aconteceu (e o que fazer se não foi você).
 */
export const emailEnabled = () => !!config.email.provider && (config.email.provider === 'file' || (!!config.email.apiKey && !!config.email.from));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Mail {
  to: string;
  subject: string;
  /** parágrafos de texto simples (viram HTML com escape) */
  lines: string[];
  /** código grande em destaque (ex.: 6 dígitos) */
  code?: string;
  /** aviso final em destaque ("Não foi você? ...") */
  warning?: string;
  /**
   * Botão (só para CRIAR conta, ex.: convite). Nunca para "entrar": o rodapé promete que o Resenha não
   * manda link de login. Só aceita o endereço oficial do Resenha.
   */
  button?: { label: string; url: string };
}

/** monta o texto e o HTML do e-mail (exportado só para a prévia em promo/ e testes) */
export function render(m: Mail) {
  const button = m.button && m.button.url.startsWith(config.officialUrl) ? m.button : null;
  const text = [
    ...m.lines,
    ...(m.code ? ['', `Código: ${m.code}`, ''] : []),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    ...(m.warning ? ['', m.warning] : []),
    '',
    '— Resenha',
    'O Resenha nunca pede sua senha por e-mail.',
  ].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b0d11;font-family:Arial,Helvetica,sans-serif;color:#e7e9ee">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#12151b;border:1px solid #232836;border-radius:14px" cellspacing="0" cellpadding="0">
<tr><td style="padding:22px 26px 8px;font-size:22px;font-weight:bold;color:#3ddc97">Resenha</td></tr>
<tr><td style="padding:6px 26px 4px;font-size:18px;font-weight:bold">${esc(m.subject)}</td></tr>
${m.lines.map((l) => `<tr><td style="padding:6px 26px;font-size:15px;line-height:1.5;color:#c9cdd6">${esc(l)}</td></tr>`).join('')}
${m.code ? `<tr><td align="center" style="padding:16px 26px"><div style="display:inline-block;padding:14px 26px;border-radius:10px;background:#0b0d11;border:2px solid #3ddc97;font-size:${m.code.length > 8 ? 24 : 32}px;letter-spacing:${m.code.length > 8 ? 3 : 8}px;font-weight:bold;color:#3ddc97;font-family:monospace">${esc(m.code)}</div></td></tr>` : ''}
${button ? `<tr><td align="center" style="padding:4px 26px 14px"><a href="${esc(button.url)}" style="display:inline-block;padding:14px 30px;border-radius:10px;background:#3ddc97;color:#06281a;font-size:16px;font-weight:bold;text-decoration:none">${esc(button.label)}</a></td></tr>` : ''}
${m.warning ? `<tr><td style="padding:10px 26px"><div style="padding:12px 14px;border-radius:10px;background:#2a1a10;border:1px solid #f5b942;color:#f5d48a;font-size:14px;line-height:1.5">${esc(m.warning)}</div></td></tr>` : ''}
<tr><td style="padding:16px 26px 22px;font-size:12px;color:#7d8494">O Resenha nunca pede sua senha por e-mail nem manda link para entrar. Na dúvida, abra o Resenha você mesmo.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

// último resultado (aparece no Painel da equipe → Sistema, para descobrir rápido o que está errado)
let lastError: { at: string; status: number; detail: string; hint: string } | null = null;
let lastOkAt: string | null = null;
export const emailStatus = () => ({
  enabled: emailEnabled(),
  provider: config.email.provider || null,
  from: config.email.from || null,
  lastOkAt,
  lastError,
});

/** Traduz as recusas mais comuns do provedor em "o que fazer". */
function explain(status: number, body: string): string {
  const b = body.toLowerCase();
  if (/ip address|unrecogni[sz]ed ip|authorised ip|authorized ip/.test(b)) {
    return 'A Brevo bloqueou o endereço do servidor. Na Brevo: menu do seu nome → Security → Authorized IPs → desative "Block unknown IP addresses" (o Render muda de IP).';
  }
  if (/sender|from/.test(b) && /valid|verif|not.*(allowed|exist)/.test(b)) {
    return `O remetente (EMAIL_FROM = ${config.email.from}) não está confirmado na Brevo. Em Senders, domains & IPs → Senders, confirme esse e-mail.`;
  }
  if (/not.*activated|permission_denied|account.*(suspended|blocked)/.test(b) || status === 403) {
    return 'A conta da Brevo ainda não está liberada para enviar e-mails (contas novas às vezes passam por análise). Veja o aviso no painel da Brevo ou fale com o suporte deles.';
  }
  if (/key not found|invalid api key|api key/.test(b) || status === 401) return 'A chave da API (EMAIL_API_KEY) está errada ou foi apagada. Gere outra na Brevo em SMTP & API → API keys.';
  if (status === 402 || /credit|quota|limit/.test(b)) return 'O limite de e-mails do plano grátis acabou por hoje (300/dia na Brevo).';
  return 'Veja a mensagem do provedor acima.';
}

/** Envia (sem travar quem chamou se o provedor falhar: o erro vai para o log). */
export async function sendEmail(m: Mail): Promise<boolean> {
  if (!emailEnabled()) return false;
  // site de teste: deixa claro no assunto (ninguém confunde com o Resenha oficial)
  if (config.appEnv === 'staging' && !m.subject.startsWith('[TESTE]')) m = { ...m, subject: `[TESTE] ${m.subject}` };
  const { text, html } = render(m);
  const { provider, apiKey, from, fromName } = config.email;
  try {
    if (provider === 'file') {
      if (process.env.EMAIL_FAIL_TEST) {
        // só nos testes: simula uma recusa do provedor
        lastError = { at: new Date().toISOString(), status: 401, detail: process.env.EMAIL_FAIL_TEST, hint: explain(401, process.env.EMAIL_FAIL_TEST) };
        return false;
      }
      appendFileSync(config.email.outbox, JSON.stringify({ to: m.to, subject: m.subject, text, code: m.code ?? null, at: new Date().toISOString() }) + '\n');
      lastOkAt = new Date().toISOString();
      return true;
    }
    const res =
      provider === 'brevo'
        ? await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: m.to }], subject: m.subject, htmlContent: html, textContent: text }),
            signal: AbortSignal.timeout(10_000),
          })
        : await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: `${fromName} <${from}>`, to: [m.to], subject: m.subject, html, text }),
            signal: AbortSignal.timeout(10_000),
          });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 400);
      lastError = { at: new Date().toISOString(), status: res.status, detail: body, hint: explain(res.status, body) };
      console.warn(`[email] ${provider} recusou: ${res.status} ${body}`);
      return false;
    }
    lastOkAt = new Date().toISOString();
    lastError = null;
    return true;
  } catch (err) {
    lastError = { at: new Date().toISOString(), status: 0, detail: (err as Error).message, hint: 'O servidor não conseguiu falar com o provedor de e-mail (rede). Tente de novo em alguns minutos.' };
    console.warn('[email] falha ao enviar', (err as Error).message);
    return false;
  }
}

/** "an***@gmail.com": mostra o e-mail sem revelar tudo. */
export function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(2, user.length - 2))}@${domain}`;
}
