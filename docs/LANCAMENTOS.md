# Site de teste e site oficial

> **Situação atual (10/11): adiado.** Para não arriscar passar das 750 horas grátis do Render, continuamos com um
> site só, que atualiza a cada mudança na branch de trabalho (como antes). Este passo a passo fica pronto para
> quando o site oficial for para o plano pago. Ao criar o site de teste, defina também no GitHub
> (**Settings → Secrets and variables → Actions → Variables**) a variável `RELEASE_BRANCH` = `main`, para o app
> de Windows só publicar versões a partir do oficial.

Dois sites, o mesmo código:

| | Site de **teste** | Site **oficial** |
|---|---|---|
| Atualiza com | cada mudança na branch `claude/screen-sharing-app-w2m6ft` | só quando você aprova (junta no `main`) |
| Quem usa | você (e quem você chamar para testar) | todo mundo |
| Banco, arquivos, chaves | **próprios** (contas e mensagens separadas) | os de hoje |
| Aviso | faixa amarela "SITE DE TESTE", `[TESTE]` na aba e nos e-mails | nenhum |
| App de Windows | o instalador de teste fica no GitHub Actions ("Artifacts") | a versão nova é publicada e os apps atualizam sozinhos |

## Como fica o dia a dia

1. Eu faço as mudanças na branch de trabalho. O **site de teste** atualiza sozinho em alguns minutos.
2. Você testa lá (o roteiro está em `docs/ETAPAS-E-TESTES.md`).
3. Gostou? Me fala "pode lançar" (ou abra você mesmo um Pull Request da branch para o `main`).
   Eu abro o **Pull Request de lançamento** com o resumo do que muda.
4. Você clica em **Merge** no GitHub, de preferência num horário com pouca gente (de madrugada, por exemplo).
   O **site oficial** atualiza em alguns minutos, a call não cai (a voz continua durante a atualização) e o
   pop-up de novidades aparece depois que a pessoa sair da call.
5. Se tinha versão nova do app de Windows, ela é publicada nesse momento e os apps se atualizam.

> Deu algo errado no oficial? No Render, em **Events**, clique em **Rollback** no deploy anterior: o site volta
> para a versão de antes em um minuto. Depois a gente corrige com calma no teste.

---

## Passo a passo (uma vez só, uns 20 minutos)

Faça **nesta ordem**. Se trocar o site oficial para o `main` antes do passo 1, ele voltaria para a versão inicial.

### 1. Juntar tudo no `main`

1. No GitHub, abra o Pull Request **"Lançamento: Resenha até 10/11"** (eu já abri) e clique em **Merge pull request**.
2. Pronto: o `main` agora tem tudo o que o site oficial já roda hoje.

### 2. Site oficial passa a seguir o `main` (Render)

1. No Render, abra o serviço que você já tem (o do `resenha-m2bt.onrender.com`).
2. **Settings → Build & Deploy → Branch**: troque para `main` e salve.
3. Ele faz um deploy com o mesmo código de hoje (não muda nada para ninguém).

### 3. Banco do site de teste (Neon)

1. No Neon, abra o mesmo projeto do Resenha.
2. Em **Databases**, clique em **New Database**, nome `resenha_teste`. Ele nasce vazio e o Resenha cria as tabelas sozinho.
3. Clique em **Connect**, escolha o banco `resenha_teste` e copie a connection string.
   (Ela é igual à do oficial, mas termina em `/resenha_teste?...`.)

> Não use "branch" do Neon copiando o banco oficial: isso copiaria as contas e mensagens reais para o teste.

### 4. Arquivos do site de teste (Cloudflare R2)

1. No Cloudflare, em **R2**, clique em **Create bucket**, nome `resenha-arquivos-teste`.
2. Se o token de API que o Resenha usa hoje foi criado só para o bucket oficial, crie outro em
   **Manage R2 API Tokens → Create API token** (permissão **Object Read & Write**, só no bucket
   `resenha-arquivos-teste`) e guarde o Access Key ID e o Secret Access Key.
   **Não me mande esses valores**: você vai colar direto no Render no passo 5.

### 5. Criar o site de teste (Render)

1. No Render, **New → Web Service**, escolha este repositório.
2. Preencha:
   - **Name**: `resenha-teste`
   - **Branch**: `claude/screen-sharing-app-w2m6ft`
   - **Region**: Virginia (a mesma do banco)
   - **Build Command**: `npm ci --include=dev && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
   - Em **Advanced → Health Check Path**: `/api/health`
3. Em **Environment Variables**:

| Variável | Valor |
|---|---|
| `APP_ENV` | `staging` |
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | a connection string do passo 3 (`/resenha_teste`) |
| `R2_ACCOUNT_ID` | o mesmo do oficial |
| `R2_BUCKET` | `resenha-arquivos-teste` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | os do token que tem acesso ao bucket de teste |
| `PLATFORM_ADMINS` | o mesmo do oficial (seu usuário) |
| `REGISTRATION_CODE` | um código só seu para criar contas no teste |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | os mesmos do oficial (os e-mails saem com `[TESTE]` no assunto) |
| `METERED_TURN_DOMAIN`, `METERED_TURN_API_KEY` | os mesmos do oficial (a cota do TURN é dividida entre os dois) |

   **Deixe de fora** no teste: `BACKUP_KEY` (o teste não precisa de backup), `TURNSTILE_*` (sem captcha no teste) e
   `PRIVACY_CONTACT` (usa o padrão).
4. **Create Web Service**. O endereço vai ser algo como `https://resenha-teste.onrender.com`.
5. Abra o endereço: deve aparecer a faixa amarela **SITE DE TESTE**. Crie sua conta de teste lá (é separada da oficial).

### 6. App de Windows apontando para o teste (opcional)

O app instalado continua no oficial. Para testar o app no site de teste, crie um atalho do Resenha e, em
**Propriedades → Destino**, acrescente no fim:

```
--url=https://resenha-teste.onrender.com --profile=%APPDATA%\Resenha-teste
```

(o `--profile` guarda o login do teste separado do oficial). Instaladores de teste ficam no GitHub em
**Actions → App de desktop (Windows) → a execução → Artifacts**.

---

## Bom saber

- **Horas grátis do Render**: o plano grátis tem 750 horas por mês somando todos os serviços. O site de teste
  "dorme" depois de 15 minutos sem uso (não coloque monitor de "manter acordado" nele). Se o oficial ficar
  acordado o mês inteiro (~730 horas), sobra pouco para o teste. Se as horas acabarem, os serviços grátis
  param até o mês virar. A saída definitiva é o oficial no plano pago mais barato do Render (sem dormir e sem
  gastar as horas grátis); aí o teste fica à vontade no grátis.
- **Neon grátis**: dois bancos no mesmo projeto dividem o limite de espaço e de horas de processamento do plano.
  O banco de teste é pequeno.
- **Segurança**: o site de teste tem chaves e dados próprios. Nada do que acontece lá chega nas contas oficiais.
