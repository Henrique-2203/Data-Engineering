// Ajudas para testes de tela. O app não usa mais o confirm() do navegador (some em Android/Electron/janelas embutidas):
// usa uma janela própria (role="alertdialog"). Estes ajudantes clicam nela como a pessoa faria.

/**
 * confirma sozinho toda janela de confirmação do app que aparecer, a qualquer momento (equivale ao antigo
 * page.on('dialog', d => d.accept())). Roda em segundo plano até a página fechar.
 */
export function autoConfirm(page) {
  let on = true;
  page.on('close', () => (on = false));
  void (async () => {
    while (on) {
      try {
        const botao = page.locator('[role="alertdialog"] button').last(); // o último botão é o de confirmar
        if (await botao.count()) await botao.click({ timeout: 1000 });
      } catch {
        /* a janela fechou no meio: segue */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
}

/** texto da janela de confirmação aberta (para conferir a mensagem) */
export const confirmText = (page) => page.getByRole('alertdialog').innerText();
