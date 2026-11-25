// Servidor local / hospedagem comum: API + site estatico.
//   DATABASE_URL="postgresql://..." node server.js     (ou sem DATABASE_URL: usa um banco de teste em memoria)
import express from 'express';
import { fileURLToPath } from 'node:url';
import { criarApp } from './src/app.js';
import { conectar, conectarTeste } from './src/db.js';
const sql = (f) => fileURLToPath(new URL(`./sql/${f}`, import.meta.url));
const db = process.env.DATABASE_URL ? conectar(process.env.DATABASE_URL) : await conectarTeste([sql('01_schema.sql'), sql('02_dados_exemplo.sql')]);
if (!process.env.DATABASE_URL) console.log('Sem DATABASE_URL: usando banco de teste em memoria (os dados somem ao reiniciar).');
const api = criarApp({ db });
const app = express();
app.use(api);
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
const porta = Number(process.env.PORT) || 3100;
app.listen(porta, () => console.log(`PLAYLINK em http://localhost:${porta}`));
