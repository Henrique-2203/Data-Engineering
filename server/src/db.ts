import { mkdirSync } from 'node:fs';
import { config } from './config.ts';
import { DEFAULT_EVERYONE_PERMISSIONS, Perm } from '../../shared/permissions.ts';

export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /** Lê tudo numa "foto" consistente do banco (usado pelo backup). */
  snapshot<T>(fn: (query: Db['query']) => Promise<T>): Promise<T>;
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

-- v9: lista de espera (página inicial)
create table if not exists waitlist (
  id text primary key,
  name text not null,
  email text not null unique,
  whatsapp text,
  platforms text[] not null default '{}',
  source text,
  consent_at timestamptz not null,
  invited_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

-- v10: painel de números (só contadores somados por dia, sem identificar ninguém)
create table if not exists daily_stats (
  day date not null,
  metric text not null,
  key text not null default '',
  count integer not null default 0,
  primary key (day, metric, key)
);
alter table users add column if not exists last_active_on date;

-- imagens (ícone/banner do servidor, foto/banner de perfil): pequenas e substituídas, nunca acumuladas
create table if not exists images (
  id text primary key,
  uploader_id text references users(id) on delete set null,
  mime text not null,
  size integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

-- v11: arquivos fora do banco (Cloudflare R2) ou na tabela blobs; lixeira de arquivos; cotas; backups
alter table attachments add column if not exists storage_key text;
alter table attachments alter column data drop not null;
alter table attachments add column if not exists kind text not null default 'image';
alter table attachments add column if not exists guild_id text;
alter table images add column if not exists storage_key text;
alter table images alter column data drop not null;
create index if not exists attachments_uploader_idx on attachments(uploader_id);
create index if not exists attachments_guild_idx on attachments(guild_id) where guild_id is not null;
create table if not exists blobs (
  key text primary key,
  data bytea not null
);
-- quando uma linha com arquivo some (mensagem apagada, conta excluída...), o arquivo vai para a lixeira
create table if not exists storage_trash (
  key text primary key,
  deleted_at timestamptz not null default now()
);
create or replace function resenha_trash_file() returns trigger language plpgsql as $$
begin
  if old.storage_key is not null then
    insert into storage_trash (key) values (old.storage_key) on conflict do nothing;
  end if;
  return old;
end $$;
drop trigger if exists attachments_trash on attachments;
create trigger attachments_trash after delete on attachments for each row execute function resenha_trash_file();
drop trigger if exists images_trash on images;
create trigger images_trash after delete on images for each row execute function resenha_trash_file();
create table if not exists server_secrets (
  name text primary key,
  value text not null
);
-- v12: e-mail confirmado, códigos por e-mail e histórico de segurança da conta
alter table users add column if not exists email text;
alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists password_checked_at timestamptz;
alter table users add column if not exists password_leaked boolean not null default false;
create unique index if not exists users_email_idx on users (lower(email)) where email is not null;
create table if not exists email_codes (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  purpose text not null,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists email_codes_user_idx on email_codes(user_id, purpose);
create table if not exists security_events (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  type text not null,
  device text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists security_events_user_idx on security_events(user_id, created_at desc);
-- v13: cadastro com e-mail confirmado (a conta só nasce depois do código)
create table if not exists pending_signups (
  id text primary key,
  email text not null,
  username text not null,
  display_name text not null,
  password_hash text not null,
  password_checked boolean not null default false,
  terms boolean not null default false,
  code_hash text not null,
  attempts integer not null default 0,
  sends integer not null default 1,
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- v14: registro de auditoria dos servidores
create table if not exists audit_log (
  id text primary key,
  guild_id text not null references guilds(id) on delete cascade,
  actor_id text references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  target_label text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_log_guild_idx on audit_log(guild_id, created_at desc);
-- v15: Etapa 4 (fixar, enquetes, modo lento, moderação automática, eventos e notificações no celular)
alter table messages add column if not exists pinned_at timestamptz;
alter table messages add column if not exists pinned_by text;
create index if not exists messages_pinned_idx on messages(channel_id, pinned_at) where pinned_at is not null;
create index if not exists messages_author_idx on messages(author_id, channel_id, created_at desc);
create table if not exists polls (
  message_id text primary key references messages(id) on delete cascade,
  question text not null,
  options jsonb not null,
  multi boolean not null default false,
  ends_at timestamptz not null
);
create table if not exists poll_votes (
  message_id text not null references polls(message_id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  option integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id, option)
);
alter table channels add column if not exists slowmode integer not null default 0;
alter table guilds add column if not exists automod jsonb not null default '{}';
create table if not exists guild_events (
  id text primary key,
  guild_id text not null references guilds(id) on delete cascade,
  channel_id text references channels(id) on delete set null,
  creator_id text references users(id) on delete set null,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists guild_events_guild_idx on guild_events(guild_id, starts_at);
create table if not exists guild_event_interest (
  event_id text not null references guild_events(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (event_id, user_id)
);
create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  failures integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
with first_time as (insert into schema_flags (name) values ('v15_everyone_events') on conflict do nothing returning 1)
update guilds set everyone_permissions = everyone_permissions | ${Perm.CREATE_EVENTS}
where exists (select 1 from first_time);
-- v16: suporte (chamados) e novidades já vistas por conta
create table if not exists support_tickets (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  category text not null,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  user_unread boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on support_tickets(user_id, updated_at desc);
create index if not exists support_tickets_status_idx on support_tickets(status, updated_at);
create table if not exists support_messages (
  id text primary key,
  ticket_id text not null references support_tickets(id) on delete cascade,
  from_team boolean not null default false,
  body text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists support_messages_ticket_idx on support_messages(ticket_id, created_at);
alter table users add column if not exists changelog_seen text;
create table if not exists backups (
  id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  size bigint,
  tables integer,
  rows bigint,
  verified boolean,
  error text
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
      snapshot: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('begin isolation level repeatable read read only');
          const out = await fn(async (sql, params) => (await client.query(sql, params as any[])).rows);
          await client.query('commit');
          return out;
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
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
      // o PGlite tem uma conexão só: uma transação longa travaria o app, então lê direto
      snapshot: (fn) => fn(async (sql, params) => (await lite.query<any>(sql, params as any[])).rows),
    };
    console.log(`[db] usando Postgres embutido (PGlite) em ${config.dataDir}`);
  }
  await db.exec(SCHEMA);
  return db;
}
