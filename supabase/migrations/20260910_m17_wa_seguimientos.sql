-- ============================================================================
--  M17 · Seguimientos automáticos por WhatsApp — la cola con aprobación
--        (10 sep 2026)
--
--  La app YA sabía a quién hay que dar seguimiento: AvisoCitasProximas sabe
--  quién viene mañana, pc_seguimientos sabe a qué mascota le toca la vacuna y
--  Reactivacion sabe quién lleva meses sin venir. Lo que faltaba era MANDARLO.
--
--  ── Por qué una cola y no envío directo ───────────────────────────────────
--  Porque el error aquí es irreversible y masivo. Una regla mal calibrada le
--  escribe a cientos de personas antes de que a nadie le dé tiempo de pararlo,
--  y en WhatsApp eso no se deshace: la gente reporta el número, Meta lo bloquea
--  y PetColinas pierde el WhatsApp del negocio. Por eso la tarea nocturna solo
--  PROPONE (estado 'pendiente') y alguien aprueba desde la app. Cuando lleve
--  semanas sin equivocarse se enciende `wa_auto` en pc_config y la misma cola
--  se manda sola. El interruptor existe desde ya, apagado.
--
--  ── Por qué plantillas y no texto libre ───────────────────────────────────
--  No es decisión de diseño, es la regla de Meta: fuera de las 24 horas
--  siguientes al último mensaje DEL CLIENTE solo se puede enviar una plantilla
--  aprobada por ellos. Un seguimiento es, por definición, fuera de esa ventana.
--  Así que la IA no redacta libremente estos mensajes: rellena las variables de
--  una plantilla que Meta ya revisó. Donde la IA sí escribe libre es en las
--  RESPUESTAS, que caen dentro de la ventana — eso ya lo hace whatsapp-bot.
--
--  ── Lo que enseñó la primera corrida en seco ──────────────────────────────
--  1. Proponía 83 reactivaciones de una sentada. Un "aprobar todo" en un número
--     recién migrado es exactamente como se pierde el WhatsApp del negocio.
--     → tope diario configurable (`wa_max_reactivacion_dia`, arranca en 15).
--  2. El mensaje decía "Hola Yenibel canelo": 219 de 735 fichas traen el nombre
--     de la mascota pegado al del dueño. Y "le toca bano_medicado", que es un
--     código interno, no español.
--     → pc_wa_nombre(), pc_wa_mascota() y pc_wa_tipo_legible(). Se arregla al
--       armar el mensaje y NO reescribiendo las 219 fichas: hay nombres
--       compuestos legítimos y desde aquí no hay forma de saber dónde acaba el
--       nombre de la persona y empieza el del perro.
--
--  Idempotente. Este archivo es el estado final de lo aplicado en producción.
-- ============================================================================

-- 1) Las plantillas ---------------------------------------------------------
-- `nombre_meta` e `idioma` tienen que coincidir EXACTAMENTE con lo aprobado en
-- Meta → WhatsApp Manager → Plantillas. `cuerpo` es la misma copia del texto,
-- guardada aquí para poder enseñar en la app lo que le va a llegar al cliente.
create table if not exists public.pc_wa_plantillas (
  clave        text primary key,
  nombre_meta  text not null,
  idioma       text not null default 'es',
  categoria    text not null default 'UTILITY' check (categoria in ('UTILITY','MARKETING')),
  cuerpo       text not null,
  descripcion  text,
  activa       boolean default true,
  actualizado  timestamptz default now()
);
alter table public.pc_wa_plantillas enable row level security;
drop policy if exists pc_wa_plantillas_leer on public.pc_wa_plantillas;
create policy pc_wa_plantillas_leer on public.pc_wa_plantillas for select to authenticated
  using ((select public.pc_es_personal()));
drop policy if exists pc_wa_plantillas_admin on public.pc_wa_plantillas;
create policy pc_wa_plantillas_admin on public.pc_wa_plantillas for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
revoke all on public.pc_wa_plantillas from anon;

insert into public.pc_wa_plantillas (clave, nombre_meta, idioma, categoria, cuerpo, descripcion) values
  ('cita_recordatorio', 'cita_recordatorio', 'es', 'UTILITY',
   'Hola {{1}} 👋 Le recordamos la cita de {{2}} en PetColinas: {{3}} a las {{4}}. Si no puede asistir, respóndanos por aquí y la movemos. ¡Le esperamos!',
   'Se manda el día antes de la cita. 1=propietario 2=mascota 3=fecha 4=hora'),
  ('vacuna_recordatorio', 'vacuna_recordatorio', 'es', 'UTILITY',
   'Hola {{1}} 👋 A {{2}} le toca {{3}} ({{4}}). Respóndanos por aquí y le buscamos cita en PetColinas.',
   'Vacuna o antiparasitario vencido o por vencer. 1=propietario 2=mascota 3=qué toca 4=fecha prevista'),
  ('reactivacion', 'reactivacion', 'es', 'MARKETING',
   'Hola {{1}} 👋 Hace tiempo que no vemos a {{2}} por PetColinas. Si quiere agendar un baño o una consulta, respóndanos por aquí y buscamos el día que mejor le quede.',
   'Cliente que lleva meses sin venir. OJO: Meta la cobra como MARKETING y es la que más reportes genera. 1=propietario 2=mascota')
on conflict (clave) do nothing;

-- 2) Quién NO quiere que le escriban ----------------------------------------
-- Por teléfono y no por cliente a propósito: una misma casa tiene varias
-- mascotas, y cuando alguien dice "no me escriban más" lo dice para todas.
create table if not exists public.pc_wa_optout (
  telefono  text primary key,
  motivo    text,
  fecha     timestamptz default now()
);
alter table public.pc_wa_optout enable row level security;
drop policy if exists pc_wa_optout_personal on public.pc_wa_optout;
create policy pc_wa_optout_personal on public.pc_wa_optout for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
revoke all on public.pc_wa_optout from anon;

-- 3) La cola ----------------------------------------------------------------
create table if not exists public.pc_wa_cola (
  id            bigserial primary key,
  telefono      text not null,
  propietario   text,
  mascota       text,
  tipo          text not null,          -- cita | vacuna | reactivacion
  plantilla     text not null references public.pc_wa_plantillas(clave),
  variables     jsonb not null default '[]'::jsonb,
  texto         text not null,          -- el mensaje ya armado, para la vista previa
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','aprobado','enviado','descartado','error')),
  motivo        text,                   -- por qué se propuso, para entenderlo de un vistazo
  -- Sin esto, la cita de mañana se propondría de nuevo cada madrugada.
  clave_dedupe  text not null unique,
  creado        timestamptz default now(),
  aprobado_por  text,
  aprobado_en   timestamptz,
  enviado_en    timestamptz,
  waid          text,
  error         text
);
create index if not exists pc_wa_cola_estado_idx on public.pc_wa_cola (estado, creado desc);
create index if not exists pc_wa_cola_tel_idx    on public.pc_wa_cola (telefono, creado desc);
alter table public.pc_wa_cola enable row level security;
drop policy if exists pc_wa_cola_personal on public.pc_wa_cola;
create policy pc_wa_cola_personal on public.pc_wa_cola for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
revoke all on public.pc_wa_cola from anon;
revoke all on sequence public.pc_wa_cola_id_seq from anon;

-- 4) Armar el texto ----------------------------------------------------------
-- La vista previa de la app y lo que Meta manda de verdad tienen que decir lo
-- MISMO. Por eso se arma una sola vez, aquí, y la app solo lo muestra.
create or replace function public.pc_wa_render(p_cuerpo text, p_vars jsonb)
returns text language plpgsql immutable as $$
declare v_texto text := p_cuerpo; i int;
begin
  for i in 1 .. coalesce(jsonb_array_length(p_vars), 0) loop
    v_texto := replace(v_texto, '{{' || i || '}}', coalesce(p_vars ->> (i - 1), ''));
  end loop;
  return v_texto;
end $$;

-- Teléfono en el formato que quiere Meta (18095551212). Si no cuadra devuelve
-- null y esa fila NO se propone: mandar a un número mal formado es mandárselo
-- a otra persona.
create or replace function public.pc_wa_tel(p_tel text)
returns text language sql immutable as $$
  select case
    when length(d) = 10 then '1' || d
    when length(d) = 11 and left(d,1) = '1' then d
    else null
  end
  from (select regexp_replace(coalesce(p_tel,''), '\D', '', 'g') as d) x;
$$;

-- Primer nombre del dueño. "Yenibel canelo" → "Yenibel". Si lo único que hay es
-- el nombre de la mascota, se saluda sin nombre: mejor un saludo genérico que
-- llamar al dueño como al perro.
create or replace function public.pc_wa_nombre(p_propietario text, p_mascota text)
returns text language sql immutable as $$
  select case
    when primero = '' then 'vecino/a'
    when lower(primero) = lower(split_part(trim(coalesce(p_mascota,'')), ' ', 1)) then 'vecino/a'
    else primero
  end
  from (select initcap(split_part(trim(coalesce(p_propietario, '')), ' ', 1)) as primero) x;
$$;

-- El apellido del dueño también está pegado al nombre de la mascota: "Akira
-- canelo", "Shayna Sanchez". Escrito así, "A Shayna Sanchez le toca su baño"
-- parece que le hablamos a una persona. Una mascota llamada "Bola de Nieve"
-- queda como "Bola", que sigue siendo mejor que arrastrar el apellido.
create or replace function public.pc_wa_mascota(p_mascota text)
returns text language sql immutable as $$
  select coalesce(nullif(initcap(split_part(trim(coalesce(p_mascota, '')), ' ', 1)), ''), 'su mascota');
$$;

-- Los códigos de pc_seguimientos.tipo, en cristiano. El `else` deja legible
-- cualquier tipo nuevo que alguien invente sin tener que tocar esto.
create or replace function public.pc_wa_tipo_legible(p_tipo text)
returns text language sql immutable as $$
  select case lower(trim(coalesce(p_tipo, '')))
    when 'antipulgas'            then 'su antipulgas'
    when 'bano_medicado'         then 'su baño medicado'
    when 'bano_regular'          then 'su baño'
    when 'vacuna_rabia'          then 'la vacuna de rabia'
    when 'vacuna_quintuple'      then 'la vacuna quíntuple'
    when 'vacuna_bordetella'     then 'la vacuna de bordetella'
    when 'vacuna_giardia'        then 'la vacuna de giardia'
    when 'control_post_consulta' then 'su control después de la consulta'
    when ''                      then 'su refuerzo'
    else replace(lower(trim(p_tipo)), '_', ' ')
  end;
$$;

revoke all on function public.pc_wa_render(text, jsonb)  from public, anon;
revoke all on function public.pc_wa_tel(text)            from public, anon;
revoke all on function public.pc_wa_nombre(text, text)   from public, anon;
revoke all on function public.pc_wa_mascota(text)        from public, anon;
revoke all on function public.pc_wa_tipo_legible(text)   from public, anon;

-- Los advisors marcan como WARN cualquier función sin search_path fijo: sin
-- fijarlo, quien la llama decide qué `replace` o qué `initcap` se ejecuta de
-- verdad, creando objetos en un esquema que vaya antes en SU search_path.
alter function public.pc_wa_render(text, jsonb)  set search_path = public, pg_temp;
alter function public.pc_wa_tel(text)            set search_path = public, pg_temp;
alter function public.pc_wa_nombre(text, text)   set search_path = public, pg_temp;
alter function public.pc_wa_mascota(text)        set search_path = public, pg_temp;
alter function public.pc_wa_tipo_legible(text)   set search_path = public, pg_temp;

-- 5) La tarea nocturna: PROPONE, no manda ------------------------------------
create or replace function public.pc_tarea_wa_cola()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy    date := (current_date at time zone 'America/Santo_Domingo')::date;
  v_log    bigint;
  v_filas  integer := 0;
  v_n      integer;
  v_tope   integer;
begin
  select coalesce(nullif(regexp_replace(coalesce(valor,''), '\D', '', 'g'), '')::int, 15)
    into v_tope from public.pc_config where clave = 'wa_max_reactivacion_dia';
  v_tope := coalesce(v_tope, 15);

  insert into public.pc_tareas_log (tarea, detalle)
  values ('wa_cola', 'propuestas del ' || v_hoy || ' (tope react ' || v_tope || ')')
  returning id into v_log;

  -- (a) Cita de mañana --------------------------------------------------------
  with candidatas as (
    select c.id, c.fecha, c.hora,
           public.pc_wa_nombre(c.nombrecliente, c.nombremascota) as propietario,
           public.pc_wa_mascota(c.nombremascota) as mascota,
           public.pc_wa_tel(c.telefono) as tel
      from public.pc_citas c
     where c.fecha = to_char(v_hoy + 1, 'YYYY-MM-DD')
       and coalesce(c.estado, '') not in ('cancelada', 'completada', 'no_asistio')
       and public.pc_wa_tel(c.telefono) is not null
  )
  insert into public.pc_wa_cola (telefono, propietario, mascota, tipo, plantilla, variables, texto, motivo, clave_dedupe)
  select k.tel, k.propietario, k.mascota, 'cita', 'cita_recordatorio',
         jsonb_build_array(k.propietario, k.mascota, to_char(k.fecha::date, 'DD/MM'), coalesce(k.hora, '')),
         public.pc_wa_render(p.cuerpo, jsonb_build_array(k.propietario, k.mascota, to_char(k.fecha::date, 'DD/MM'), coalesce(k.hora, ''))),
         'Cita mañana ' || k.fecha || ' ' || coalesce(k.hora, ''),
         'cita:' || k.id
    from candidatas k cross join public.pc_wa_plantillas p
   where p.clave = 'cita_recordatorio' and p.activa
     and not exists (select 1 from public.pc_wa_optout o where o.telefono = k.tel)
  on conflict (clave_dedupe) do nothing;
  get diagnostics v_n = row_count; v_filas := v_filas + v_n;

  -- (b) Vacuna / antiparasitario ---------------------------------------------
  -- Desde 30 días vencido hasta 7 por vencer: más atrás de 30 días ya no es
  -- recordar, es perseguir a la gente.
  with candidatas as (
    select s.id, s.proximafecha,
           public.pc_wa_tipo_legible(s.tipo) as que_toca,
           public.pc_wa_nombre(s.propietario, s.mascota) as propietario,
           public.pc_wa_mascota(s.mascota) as mascota,
           public.pc_wa_tel(s.telefono) as tel
      from public.pc_seguimientos s
     where coalesce(s.activo, true) and not coalesce(s.completado, false)
       and s.proximafecha ~ '^\d{4}-\d{2}-\d{2}$'
       and s.proximafecha::date between v_hoy - 30 and v_hoy + 7
       and public.pc_wa_tel(s.telefono) is not null
  )
  insert into public.pc_wa_cola (telefono, propietario, mascota, tipo, plantilla, variables, texto, motivo, clave_dedupe)
  select k.tel, k.propietario, k.mascota, 'vacuna', 'vacuna_recordatorio',
         jsonb_build_array(k.propietario, k.mascota, k.que_toca, to_char(k.proximafecha::date, 'DD/MM')),
         public.pc_wa_render(p.cuerpo, jsonb_build_array(k.propietario, k.mascota, k.que_toca, to_char(k.proximafecha::date, 'DD/MM'))),
         'Toca ' || k.que_toca || ' el ' || k.proximafecha,
         'seg:' || k.id || ':' || k.proximafecha
    from candidatas k cross join public.pc_wa_plantillas p
   where p.clave = 'vacuna_recordatorio' and p.activa
     and not exists (select 1 from public.pc_wa_optout o where o.telefono = k.tel)
  on conflict (clave_dedupe) do nothing;
  get diagnostics v_n = row_count; v_filas := v_filas + v_n;

  -- (c) Reactivación ----------------------------------------------------------
  -- La delicada: Meta la cobra como MARKETING y es la que más reportes genera.
  -- Freno de mano: una vez al mes por teléfono (va en la clave de dedupe),
  -- nunca antes de 60 días desde la última, una por CASA (varias mascotas
  -- comparten teléfono), solo entre 90 y 400 días sin venir —a quien lleva más
  -- de un año escribirle de la nada se siente como spam— y con tope diario.
  with ultima as (
    select public.pc_wa_tel(cl.telefono) as tel,
           max(cl.nombrepropietario) as prop_crudo,
           max(cl.nombremascota) as masc_cruda,
           max(v.fecha::date) as ultima_visita
      from public.pc_clientes cl
      left join public.pc_ventas v
        on v.fecha ~ '^\d{4}-\d{2}-\d{2}$'
       and lower(trim(coalesce(v.cliente, ''))) = lower(trim(coalesce(cl.nombremascota, '')))
     where public.pc_wa_tel(cl.telefono) is not null
     group by public.pc_wa_tel(cl.telefono)
  ), candidatas as (
    select u.*,
           public.pc_wa_nombre(u.prop_crudo, u.masc_cruda) as propietario,
           public.pc_wa_mascota(u.masc_cruda) as mascota
      from ultima u
     where u.ultima_visita is not null
       and u.ultima_visita between v_hoy - 400 and v_hoy - 90
       and not exists (select 1 from public.pc_wa_optout o where o.telefono = u.tel)
       and not exists (
         select 1 from public.pc_wa_cola q
          where q.telefono = u.tel and q.tipo = 'reactivacion'
            and q.creado > now() - interval '60 days')
     order by u.ultima_visita desc          -- el más reciente primero
     limit v_tope
  )
  insert into public.pc_wa_cola (telefono, propietario, mascota, tipo, plantilla, variables, texto, motivo, clave_dedupe)
  select k.tel, k.propietario, k.mascota, 'reactivacion', 'reactivacion',
         jsonb_build_array(k.propietario, k.mascota),
         public.pc_wa_render(p.cuerpo, jsonb_build_array(k.propietario, k.mascota)),
         'Sin venir desde ' || k.ultima_visita,
         'react:' || k.tel || ':' || to_char(v_hoy, 'YYYY-MM')
    from candidatas k cross join public.pc_wa_plantillas p
   where p.clave = 'reactivacion' and p.activa
  on conflict (clave_dedupe) do nothing;
  get diagnostics v_n = row_count; v_filas := v_filas + v_n;

  update public.pc_tareas_log set fin = now(), ok = true, filas = v_filas where id = v_log;
  return v_filas;
exception when others then
  update public.pc_tareas_log set fin = now(), ok = false,
         detalle = coalesce(detalle,'') || ' | ERROR: ' || sqlerrm where id = v_log;
  raise;
end $$;

-- Aprendido en M8: revocar de public y anon NO alcanza — Supabase le otorga
-- EXECUTE a `authenticated` por privilegios por defecto.
revoke all on function public.pc_tarea_wa_cola() from public, anon, authenticated;
grant execute on function public.pc_tarea_wa_cola() to service_role;

-- 6) Horario -----------------------------------------------------------------
-- 05:45 de Santo Domingo (09:45 UTC), justo después del resumen diario de M8,
-- para que la lista esté armada cuando se abra la clínica.
select cron.schedule('wa_cola', '45 9 * * *', $cron$select public.pc_tarea_wa_cola();$cron$);

-- 7) Los interruptores, en su sitio seguro -----------------------------------
insert into public.pc_config (clave, valor, nota) values
  ('wa_auto', 'no',
   'Cuando valga "si", los seguimientos aprobados salen solos sin que nadie revise. Se enciende SOLO cuando lleve semanas proponiendo bien.'),
  ('wa_max_reactivacion_dia', '15',
   'Cuántas reactivaciones como mucho se proponen por día. Subirlo solo cuando el número lleve semanas sin reportes.')
on conflict (clave) do nothing;

-- ── Prueba en seco (no manda nada, se revierte sola) ────────────────────────
--   do $$ declare n int; begin
--     n := public.pc_tarea_wa_cola();
--     raise exception 'propuestas=%', n;   -- el raise deshace los inserts
--   end $$;
