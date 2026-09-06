-- Reparacion de las 12 fichas que el formulario guardo con los campos cruzados.
-- Los valores buenos salen de la hoja de respuestas del Google Form, que es la
-- fuente de verdad. Ninguna habia sido corregida a mano, asi que no se pisa
-- trabajo de nadie.
update public.pc_clientes c set
  nombremascota      = v.mascota,
  nombrepropietario  = coalesce(v.propietario, c.nombrepropietario),
  telefono           = v.telefono,
  email              = coalesce(v.email, c.email),
  cedula             = coalesce(v.cedula, c.cedula),
  direccion          = coalesce(v.direccion, c.direccion),
  especie            = coalesce(v.especie, c.especie),
  raza               = coalesce(v.raza, c.raza),
  fechanacimiento    = v.nacimiento,
  sexo               = coalesce(v.sexo, c.sexo),
  esterilizado       = v.esterilizado,
  color              = coalesce(v.color, c.color),
  alergias           = coalesce(v.alergias, c.alergias),
  condiciones        = coalesce(v.condiciones, c.condiciones),
  veterinarioexterno = coalesce(v.vet, c.veterinarioexterno),
  notas              = v.notas
from (values
  ('1787496001705', 'Chloe', 'Chelsea Rodriguez', '8097078122', 'Chelsear451@gmail.com', '40229960600', 'SANTO DOMINGO, distrito nacional', 'Perro', 'Chihuahua Mariposa', '7 febrero 2025', 'Hembra', false, 'Amarilla', 'Ninguna', 'Ninguna', 'Virmari vazquez', 'Nos conocio | via: Recomendación de un amigo/familiar | Peso: 4.5 | Vacunas: Sí, todas al día | Emergencia: Chelsea 8097078122 | Obs: "Se pone muy nervioso con el sonido del secador." | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1787499214893', 'Lalo', 'Georgina Mercedes Portes', '8096975139', 'geoportes@gmail.com', '00106755952', 'Calle C, #11'' Residencial Ciudad Agraria, Sto, Dgo, Oeste', 'Perro', 'Mestizo', '05 /10/2024', 'Macho', false, 'Blanco marron rubio', 'No', 'No', 'No se', 'Nos conocio | via: Instagram | Vacunas: Sí, todas al día | Emergencia: Felix Antonio Herrera,  teléfono 8493998801 | Obs: "Se pone muy nervioso con el sonido del secador." | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1787925792757', 'Lili lopez', 'Margarita sanchez', '8296718841', 'Wy101@gmail.com', '00111223194', 'Santo domingo oeste', 'Perro', 'Metiza', '30/4/2023', 'Hembra', false, 'Marron', 'No', 'No', 'No', 'Nos conocio | via: Pasé por el local | Peso: 10k | Vacunas: Sí, todas al día | Emergencia: 8296718841 | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1787933887652', 'Miguel de cervante', 'Marcos ovalle', '829-637-3462', null, '402-2114370-0', 'C/belisario curiel #5', 'Perro', 'Shihtzu', 'Enero 2023', 'Macho', false, null, 'N/A', null, null, 'Nos conocio | via: Recomendación de un amigo/familiar | Vacunas: No | Emergencia: Marcos. 8296373462 | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788014446855', 'Enola', 'Deyanira Rodriguez', '8297158797', 'Deyanirarodriguezs@hotmail.com', '00000000000', 'Km 18 autp', 'Perro', 'Shihpoo', '3 marzo 2026', 'Hembra', false, 'Patas marrones', 'Caspa', 'No', 'Vetmot', 'Nos conocio | via: Instagram | Peso: 1.9 | Vacunas: Pendientes | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788015991409', 'Rocco/Sky', 'Jose Gonzalez', '8096021010', 'Joseradhames26@gmail.com', '40213992742', 'Colinas del Oeste, Calle La Rusilla No.1', 'Perro', 'Dogo Argentino/Pitbull', '24/06/2026', 'Macho', false, 'Rocco: Cuello Blanco, Cuerpo Gris Oscuro/Sky: Mancha Blanca, Rayas Sutiles', 'Ninguna', 'Ninguna', 'Ninguno', 'Nos conocio | via: Pasé por el local | Vacunas: Pendientes | Emergencia: Luz Cabrera, 8092358258 | Obs: "Se orina por sumisión cuando lo saludan con mucha energía." | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788361281636', 'Junho', 'Georgina maria Florentino', '829-920-0295', 'georginaflorentino05@gmail.com', '093-0046559-9', 'Calle respaldo Eusebio Lugo, Monte largo. Haina; S.C.', 'Perro', 'Pomerania', '11/08/2025', 'Macho', false, 'Anaranjado con blanco', 'No se, hasta ahora nunca ha presentado alergia', 'Tiene problemas intestinales', 'No', 'Nos conocio | via: Instagram | Peso: 3 kg.  | Vacunas: Sí, todas al día | Emergencia: Georgina 829-920-0295  | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788617784419', 'Tobby y Lola Suazo', 'NERSY BERIGUETE', '8098909236', 'massyorozco@gmail.com', '01100378361', 'Alameda', 'Perro', 'Shop-Tu/ Mestizo', '2025', 'Hembra', false, null, 'Ninguna', 'Ninguna', 'Por definir', 'Nos conocio | via: Recomendación de un amigo/familiar | Peso: N/A | Vacunas: Sí, todas al día | Emergencia: Manuel 8298017192 | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788626340959', 'Pupy', 'Melissa López Santos', '849-490-5772', 'melildpe11@gmail.com', '224-0041381-5', 'Calle 5ta numero 6 residencial San Nicolas. Loyola', 'Perro', 'Shih Tzu', '1diciembre 2026', 'Macho', false, 'Blanco con manchas gris y beige', 'N/A', 'No', 'Michelle Felix', 'Nos conocio | via: Instagram | Vacunas: Sí, todas al día | Emergencia: 8293947061 | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788637399219', 'Rocky', 'Luis felipe torres gomez', '8092167250', 'Torresluisrd@gmail.com', '076696895', 'El altagracia herrera', 'Perro', 'Américan bully', '16/11/2025', 'Macho', false, 'Blanco con marroncito', 'No', 'No', null, 'Nos conocio | via: Instagram | Peso: 20 kg | Vacunas: Sí, todas al día | Emergencia: +1 (809) 768-2107 | Obs: "Se pone muy nervioso con el sonido del secador." | Reparado 6 sep 2026 desde la hoja del formulario'),
  ('1788705381648', 'Cofita', 'Erick Barinas Garcia', '8298610291 y 8495170292', 'Erickbarinas@yahoo.es', '00102020872', 'Colinas del oeste, c202', 'Perro', 'Mestizo', '1 año y medio', 'Hembra', false, 'Blanca', 'No', 'No', 'No', 'Nos conocio | via: Pasé por el local | Vacunas: Sí, todas al día | Emergencia: 8298610291 | Reparado 6 sep 2026 desde la hoja del formulario')
) as v(id, mascota, propietario, telefono, email, cedula, direccion, especie, raza,
       nacimiento, sexo, esterilizado, color, alergias, condiciones, vet, notas)
where c.id::text = v.id;

-- La ficha de Rosmery Meran (id 1787492663113) NO esta en la hoja: esa
-- respuesta se borro del formulario. Se limpia lo que si se puede deducir del
-- propio dato dañado: el telefono venia como "Rosmery Meran 8496323415" y el
-- nombre de la mascota era en realidad su fecha de nacimiento.
update public.pc_clientes set
  nombremascota   = '(falta el nombre — revisar con el cliente)',
  telefono        = '8496323415',
  fechanacimiento = '0ctubre 2025',
  notas = 'Nos conocio | via: Pasé por el local | Ficha incompleta: la respuesta del formulario ya no esta en la hoja. Falta el nombre de la mascota.'
where id::text = '1787492663113';
