// Ponto de entrada na Vercel: uma funcao que atende tudo em /api/*
import { criarApp } from '../src/app.js';
import { conectar } from '../src/db.js';
const app = criarApp({ db: conectar(process.env.DATABASE_URL) });
export default app;
