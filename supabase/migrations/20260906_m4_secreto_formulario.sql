-- ============================================================================
--  M4 · El secreto del formulario vive en la base, no como variable de entorno
--
--  Los secrets de Edge Functions solo se ponen a mano desde el dashboard de
--  Supabase. Guardarlo en una tabla permite crearlo y rotarlo por SQL.
--
--  Primer intento: esquema `interno`, oculto de la API. NO FUNCIONO — la Edge
--  Function llega a la base por PostgREST (la misma API REST), asi que un
--  esquema oculto de la API tampoco es visible para ella. Devolvia
--  "Falta la fila FORM_INTAKE_SECRET".
--
--  Solucion: la tabla vive en `public`, pero cerrada por otro lado:
--    · RLS activo y SIN politicas   -> anon/authenticated no ven ninguna fila
--    · sin grants para anon/authenticated
--    · service_role tiene BYPASSRLS -> la Edge Function si la lee
--  Comprobado: los dos roles reciben "permission denied for table pc_secretos".
-- ============================================================================
create table if not exists public.pc_secretos (
  nombre    text primary key,
  valor     text not null,
  nota      text,
  rotado_en timestamptz default now()
);
alter table public.pc_secretos enable row level security;
revoke all on public.pc_secretos from anon, authenticated, public;
grant select, insert, update, delete on public.pc_secretos to service_role;

insert into public.pc_secretos (nombre, valor, nota) values
  ('FORM_INTAKE_SECRET', '1H5Evyq7fabCDJY90GVrmjaoZmTnUie_',
   'Lo envia form-to-crm.gs (Apps Script) en cada inscripcion del Google Form. Para rotarlo: cambiar aqui Y en la constante FORM_SECRET del .gs.')
on conflict (nombre) do update set valor = excluded.valor, rotado_en = now();

-- pg_net: permite llamar a las Edge Functions desde SQL. Se uso para probar
-- form-intake de punta a punta, y hace falta para los procesos programados.
create extension if not exists pg_net with schema extensions;

-- PENDIENTE: cuando el .gs nuevo este pegado en Apps Script y entre una
-- inscripcion de prueba, cerrar la puerta que quedo abierta anoche:
--   drop policy "pc_clientes insert formulario web" on public.pc_clientes;
