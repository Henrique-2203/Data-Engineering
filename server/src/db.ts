import { mkdirSync } from 'node:fs';
import { config } from './config.ts';
import { DEFAULT_EVERYONE_PERMISSIONS, Perm } from '../../shared/permissions.ts';

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

-- v3: respostas, reações e imagens
alter table messages add column if not exists reply_to_id text;

create table if not exists reactions (
  message_id text not null references messages(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id, emoji)
);

create table if not exists attachments (
  id text primary key,
  message_id text references messages(id) on delete cascade,
  uploader_id text not null references users(id) on delete cascade,
  filename text not null,
  mime text not null,
  size integer not null,
  width integer,
  height integer,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists attachments_message_idx on attachments(message_id);

-- v4: cargos, permissões, categorias, moderação e personalização do servidor
alter table guilds add column if not exists description text not null default '';
alter table guilds add column if not exists icon_id text;
alter table guilds add column if not exists banner_id text;
alter table guilds add column if not exists everyone_permissions integer not null default ${DEFAULT_EVERYONE_PERMISSIONS};

create table if not exists roles (
  id text primary key,
  guild_id text not null references guilds(id) on delete cascade,
  name text not null,
  color text not null default '#99aab5',
  position integer not null default 0,
  permissions integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists roles_guild_idx on roles(guild_id);

create table if not exists member_roles (
  guild_id text not null,
  user_id text not null,
  role_id text not null references roles(id) on delete cascade,
  primary key (guild_id, user_id, role_id),
  foreign key (guild_id, user_id) references members(guild_id, user_id) on delete cascade
);

alter table members add column if not exists timeout_until timestamptz;

create table if not exists bans (
  guild_id text not null references guilds(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  reason text not null default '',
  banned_by text,
  created_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create table if not exists categories (
  id text primary key,
  guild_id text not null references guilds(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table channels add column if not exists category_id text references categories(id) on delete set null;
alter table channels add column if not exists allowed_role_ids text[];
alter table channels add column if not exists bitrate integer not null default 128;
alter table channels add column if not exists user_limit integer not null default 0;

alter table messages add column if not exists mention_everyone boolean not null default false;

-- v5: perfil social
alter table users add column if not exists avatar_id text;
alter table users add column if not exists banner_id text;
alter table users add column if not exists bio text not null default '';
alter table users add column if not exists pronouns text not null default '';
alter table users add column if not exists links jsonb not null default '[]';
alter table users add column if not exists status_text text;
alter table users add column if not exists status_emoji text;
alter table users add column if not exists status_expires_at timestamptz;

-- v6: emojis, figurinhas, soundboard e perfil por servidor
create table if not exists expressions (
  id text primary key,
  guild_id text not null references guilds(id) on delete cascade,
  kind text not null check (kind in ('emoji', 'sticker', 'sound')),
  name text not null,
  file_id text not null,
  emoji text,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expressions_guild_idx on expressions(guild_id);
alter table messages add column if not exists sticker_id text;
alter table members add column if not exists nick text;
alter table members add column if not exists avatar_id text;
alter table guilds alter column everyone_permissions set default ${DEFAULT_EVERYONE_PERMISSIONS};

-- migrações que rodam uma vez só (ex.: dar as permissões novas ao @todos dos servidores que já existiam)
create table if not exists schema_flags (name text primary key);
with first_time as (insert into schema_flags (name) values ('v6_everyone_perms') on conflict do nothing returning 1)
update guilds set everyone_permissions = everyone_permissions | ${Perm.USE_SOUNDBOARD | Perm.CHANGE_NICKNAME}
where exists (select 1 from first_time);

-- v7: segurança e privacidade
alter table sessions add column if not exists device text not null default '';
alter table sessions add column if not exists last_seen_at timestamptz not null default now();
alter table users add column if not exists totp_secret text;
alter table users add column if not exists totp_enabled boolean not null default false;
alter table users add column if not exists totp_last_step bigint not null default 0;
alter table users add column if not exists terms_accepted_at timestamptz;
alter table users add column if not exists password_changed_at timestamptz;
create table if not exists recovery_codes (
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, code_hash)
);

-- v8: denúncias e suspensão de contas
create table if not exists reports (
  id text primary key,
  reporter_id text references users(id) on delete set null,
  target_type text not null check (target_type in ('message', 'user', 'guild')),
  target_id text not null,
  target_user_id text references users(id) on delete set null,
  guild_id text,
  reason text not null,
  details text not null default '',
  snapshot jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution text,
  handled_by text references users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on reports(status, created_at desc);
alter table users add column if not exists suspended_at timestamptz;
alter table users add column if not exists suspended_reason text;

-- imagens (ícone/banner do servidor, foto/banner de perfil): pequenas e substituídas, nunca acumuladas
create table if not exists images (
  id text primary key,
  uploader_id text references users(id) on delete set null,
  mime text not null,
  size integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
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
