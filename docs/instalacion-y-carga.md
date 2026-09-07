# Instalación en el PC y carga de datos reales

Guía para poner el ERP en marcha en el ordenador de Victor —Windows, sin
permisos de administrador, Node y PostgreSQL portables— y meter los datos de
verdad en un orden que no obligue a rehacer nada.

---

## 1. Antes de empezar

Hacen falta dos cosas descomprimidas en el disco. No requieren instalador ni
permisos de administrador:

| Qué | Dónde se espera |
| --- | --- |
| Node.js 20 o superior (portable) | `C:\Users\Victor\Tools\node-v24.18.0-win-x64` |
| PostgreSQL 16 (portable) | `C:\Users\Victor\Tools\pgsql` |

Si están en otro sitio, no hay que tocar los scripts: basta con definir
`ERP_NODE_DIR` y `ERP_PG_DIR` antes de lanzarlos.

Todo lo demás lo hace el script de instalación.

---

## 2. Instalación (una sola vez)

Abre PowerShell en la carpeta del proyecto y ejecuta:

```powershell
.\scripts\windows\instalar.ps1 `
  -Empresa "DINTEL ARQUITECTURA INTEGRAL, S.A.U." `
  -Nif "A00000000" `
  -AdminEmail "victor@dintel.es" `
  -AdminNombre "Victor Martín"
```

> **El NIF de la empresa se comprueba.** Si el dígito de control no cuadra, el
> script se para antes de crear nada. Es el NIF que va a salir en cada factura
> emitida, y un error ahí no se descubre hasta que lo devuelve un cliente.

El script, por orden:

1. Crea la base de datos si no existe, e imprime **la contraseña del
   superusuario `postgres`**.
2. La arranca.
3. Crea el usuario `erp` y la base `erp_dev`.
4. Escribe el fichero `.env` con la conexión y una clave de firma de sesiones
   generada al azar.
5. Instala dependencias y compila.
6. Crea las tablas, la empresa y **el usuario de Dirección**, imprimiendo su
   contraseña.

**Anota las dos contraseñas que imprime.** No vuelven a mostrarse: están
guardadas cifradas y no hay forma de recuperarlas, solo de generar otras.

Si algo falla a mitad, se puede volver a lanzar: no toca lo que ya esté hecho.

### Comprobar que ha ido bien

```powershell
npm run doctor
```

Revisa Node, dependencias, `.env`, clave de sesiones, conexión, migraciones y
usuarios. Cuando algo falla dice **qué orden ejecutar** para arreglarlo.

---

## 3. Uso diario

```powershell
.\scripts\windows\arrancar.ps1     # base de datos + API + web
```

Abre <http://localhost:3000>. La web tarda unos segundos la primera vez.

Al terminar, cierra las dos ventanas que se abren y:

```powershell
.\scripts\windows\parar-bd.ps1
```

Apagar el ordenador sin parar la base no rompe nada —PostgreSQL se recupera
solo— pero hacerlo bien evita arranques lentos.

**PostgreSQL no se levanta solo al encender el ordenador.** Después de cada
reinicio hay que ejecutar `arrancar.ps1` (o `arrancar-bd.ps1` a secas).

---

## 4. Copias de seguridad

Esto es lo primero que hay que tener por costumbre en cuanto entren datos
reales. Un ERP de obra acumula meses de albaranes, certificaciones y
expedientes que nadie va a volver a teclear.

```powershell
.\scripts\windows\copia.ps1
```

Deja el fichero en `copias\erp-AAAAMMDD-HHMM.dump`.

**Cópialo a otro sitio** —una nube, un disco externo, otro ordenador—. Una
copia que vive en el mismo disco que el original no protege del fallo que más
veces ocurre, que es que se estropee ese disco.

Cuándo hacerla:

- Antes de cada actualización del programa.
- Una vez al día mientras se estén cargando datos.
- Antes de cualquier borrado grande.

### Restaurar

```powershell
$env:ERP_CONFIRMAR_RESTAURACION="si"
npm run copia:restaurar -- copias\erp-20260907-1213.dump
```

Pide confirmación explícita a propósito: restaurar encima de datos buenos es
la forma más rápida de convertir un susto en una pérdida. Reemplaza el
contenido actual por el de la copia; lo que haya ahora y no esté en ella se
pierde.

Para ver las copias disponibles: `node scripts\copia.mjs listar`.

---

## 5. Orden de carga de los datos reales

El sistema tiene dependencias entre módulos. Este orden evita tener que volver
atrás. Los pasos marcados **(bloquea)** impiden avanzar si se saltan.

### Paso 1 — Usuarios del organigrama

`Usuarios` → uno por persona, con su puesto real.

Los puestos son los del manual de procesos, no una escala genérica: Dirección,
Jefe de Grupo, Jefe de Obra, Encargado, Estudios, Compras y Administración.
Cada uno ve y puede hacer lo que le corresponde.

Dos criterios que conviene no romper al repartir: **Compras emite los pedidos,
la obra los solicita**; y **quien registra un modificado no lo aprueba**.

### Paso 2 — Contactos **(bloquea)**

`Contactos` → clientes, proveedores y subcontratas.

El NIF se valida al guardar. Un identificador extranjero se acepta pero queda
marcado como no comprobado.

### Paso 3 — Obras **(bloquea)**

`Obras` → una por obra en curso, con:

- Código, nombre y emplazamiento
- Cliente (del paso 2)
- **PEM, presupuesto de contrata y coste objetivo**
- Fechas de inicio y fin previsto
- Jefe de Grupo, Jefe de Obra y Encargado
- Retención de garantía

Sin presupuesto de venta no hay margen que calcular; sin coste objetivo no hay
desviación que medir.

### Paso 4 — Capítulos y reparto mensual

En la ficha de la obra, las **partidas** con su presupuesto de coste: la suma
debe cuadrar con el coste objetivo.

En `Economía de obra` → `Editar planificación`, el **reparto mensual** de
producción y coste hasta fin de obra. La ficha avisa si no cuadra con el
presupuesto: un reparto que suma otra cifra hace que la evolución se compare
con un plan que no es el plan.

### Paso 5 — Situación de partida de cada obra

Para una obra que ya viene rodando, hay que cargar el pasado o los números no
tendrán sentido:

1. **Certificaciones emitidas**, en orden y a origen. Se certifica sobre el
   presupuesto vigente: si hay modificados aprobados, cárgalos antes (paso 6).
2. **Pedidos vivos** con su importe y lo ya servido.
3. **Albaranes sin factura**: son la provisión del cierre.
4. **Facturas de compra** del ejercicio en curso.

> El coste de los meses ya cerrados sale de las **facturas de compra por fecha
> de emisión**, y la producción de las **certificaciones por fecha**. Un mes
> sin nada anotado sale como «sin datos», no como un mes bueno.

### Paso 6 — Modificados

`Modificados` → los aprobados y los pendientes, con sus dos firmas por
separado. Solo cuentan como ingreso los que tienen la de la Dirección
Facultativa **y** la de la Propiedad.

Cárgalos **antes** de las certificaciones posteriores a su aprobación: la
certificación a origen se calcula sobre el presupuesto actualizado.

### Paso 7 — Licencias y acometidas

`Licencias` → un trámite por expediente, con fecha de solicitud, fecha
comprometida y fecha de concesión.

Las acometidas definitivas se registran aunque no estén pedidas: es ahí donde
el sistema avisa de que ya no llegan a tiempo. La eléctrica tiene un plazo de
referencia de **dos años**.

### Paso 8 — Homologación y trabajadores

`Homologación` → documentación de cada subcontrata. Sin plan de seguridad,
seguro de RC, certificado de la Seguridad Social y REA, la empresa queda
bloqueada: **no se le pueden aprobar facturas ni pagar**.

Después, `Acceso a obra` → los trabajadores de cada subcontrata con sus cinco
documentos. Sin ellos no pueden pisar la obra.

### Paso 9 — Apertura y saldo de caja

`Apertura de obra` → marcar lo que ya esté hecho de la checklist.

En `Tesorería`, escribir el **saldo de caja de hoy**. Sin él la previsión a 13
semanas devuelve importes pero ningún saldo: no diría si hay tensión de caja,
solo si esas semanas son netamente positivas.

---

## 6. Empezar por una obra, no por todas

Carga **una sola obra** entera —de las que están en marcha, la que mejor te
sepas— y trabaja con ella una o dos semanas antes de meter el resto.

Es más lento sobre el papel y más rápido en la práctica: los criterios que hay
que decidir —cómo se reparten los capítulos, qué entra en el coste objetivo,
quién registra qué— salen todos con la primera obra. Descubrirlos con doce
cargadas significa corregir doce.

---

## 7. Actualizar el programa

```powershell
.\scripts\windows\copia.ps1        # primero la copia, siempre
git pull
npm install
npm run build:packages
npm run db:migrate                 # aplica los cambios de estructura
npm run doctor
```

Las migraciones solo añaden; no borran datos. Aun así, la copia va primero.

---

## 8. Si algo no arranca

| Síntoma | Qué mirar |
| --- | --- |
| Cualquier cosa | `npm run doctor` |
| «connect ECONNREFUSED …:5432» | La base no está arrancada: `.\scripts\windows\arrancar-bd.ps1` |
| La base no arranca | `Get-Content C:\Users\Victor\Tools\pgdata-erp\server.log -Tail 30` |
| «Cannot find module '@erp/shared'» | `npm run build:packages` |
| La web da error al entrar | ¿Está la API en marcha? Debe responder en el puerto 3001 |
| La web abre en el puerto 3002 | Había otra copia abierta en el 3000. Ciérrala: la API solo acepta al 3000 |
| Se ha perdido la contraseña | No se puede recuperar. Otro usuario de Dirección puede crear una nueva desde `Usuarios` |

---

## 9. Lo que este montaje **no** es

Conviene tenerlo claro desde el principio:

- **Corre en un solo ordenador.** No hay acceso desde otro puesto ni desde la
  obra. Para eso haría falta ponerlo en un servidor, y es otra conversación.
- **Las copias de seguridad son manuales.** Nadie las hace por ti.
- **No hay pasarela con la contabilidad ni con Hacienda.** Lo que sale de aquí
  se pasa a mano al programa contable.

Ninguna de las tres impide empezar. Las tres conviene decidirlas antes de que
haya seis meses de datos dentro.
