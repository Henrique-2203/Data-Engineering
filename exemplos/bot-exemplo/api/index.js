// Ponto de entrada na Vercel: uma função que atende todos os endereços do bot.
import { criarBot } from '../bot.js';
export default criarBot({
  token: process.env.BOT_TOKEN,
  signingSecret: process.env.SIGNING_SECRET,
  adminKey: process.env.ADMIN_KEY,
  resenhaUrl: process.env.RESENHA_URL || 'https://resenhabr.com.br',
});
