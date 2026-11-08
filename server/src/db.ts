import { mkdirSync } from 'node:fs';
import { config } from './config.ts';

export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA = /* sql */ `
create table if not exists users (
  id text primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  avatar_color text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists guilds (
  id text primary key,
  name text not null,
  owner_id text not null references users(id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists members (
  guild_id text not null references guilds(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
create index if not exists members_user_idx on members(user_id);

create table if not exists channels (
  id text primary key,
  guild_id text not null references guilds(id) on delete cascade,
  name text not null,
  type text not null check (type in ('text', 'voice')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists channels_guild_idx on channels(guild_id);

create table if not exists messages (
  id text primary key,
  channel_id text not null references channels(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz
);
create index if not exists messages_channel_idx on messages(channel_id, created_at desc);

-- v2: mensagens diretas (canais sem servidor) e amizades
alter table channels alter column guild_id drop not null;
alter table channels drop constraint if exists channels_type_check;
alter table channels add constraint channels_type_check check (type in ('text', 'voice', 'dm'));

create table if not exists dm_members (
  channel_id text not null references channels(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  primary key (channel_id, user_id)
);
create index if not exists dm_members_user_idx on dm_members(user_id);

create table if not exists friendships (
  requester_id text not null references users(id) on delete cascade,
  addressee_id text not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester_id, addressee_id)
);
create index if not exists friendships_addressee_idx on friendships(addressee_id);
`;

export async function createDb(): Promise<Db> {
  let db: Db;
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as any[])).rows,
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
    console.log('[db] usando Postgres via DATABASE_URL');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    mkdirSync(config.dataDir, { recursive: true });
    const lite = await PGlite.create(config.dataDir);
    db = {
      query: async (sql, params) => (await lite.query<any>(sql, params as any[])).rows,
      exec: async (sql) => {
        await lite.exec(sql);
      },
      close: () => lite.close(),
    };
    console.log(`[db] usando Postgres embutido (PGlite) em ${config.dataDir}`);
  }
  await db.exec(SCHEMA);
  return db;
}
