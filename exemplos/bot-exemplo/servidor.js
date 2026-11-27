// Para rodar no seu computador:  BOT_TOKEN=... SIGNING_SECRET=... ADMIN_KEY=... node servidor.js
import { criarBot } from './bot.js';
const app = criarBot({
  token: process.env.BOT_TOKEN,
  signingSecret: process.env.SIGNING_SECRET,
  adminKey: process.env.ADMIN_KEY,
  resenhaUrl: process.env.RESENHA_URL || 'https://resenhabr.com.br',
});
const porta = Number(process.env.PORT) || 3000;
app.listen(porta, () => console.log(`Bot em http://localhost:${porta}`));
