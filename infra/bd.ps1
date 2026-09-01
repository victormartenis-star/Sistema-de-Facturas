<#
.SYNOPSIS
  Atajos para la base de datos del ERP. Funciona con Postgres nativo o con Docker.

.DESCRIPTION
  Detecta solo que motor tienes disponible:
    - nativo: servicio postgresql-x64-16 instalado en Windows
    - docker: infra/docker/docker-compose.yml
  Fuerza uno con -Modo nativo | -Modo docker.

  El script vive en infra/ pero opera siempre desde la raiz del repositorio,
  porque los `npm run` son scripts del workspace raiz.

.EXAMPLE
  .\infra\bd.ps1 up                  # arranca el motor y espera conexiones
  .\infra\bd.ps1 crear               # crea el rol erp y la base erp_dev
  .\infra\bd.ps1 migrate             # up + migraciones
  .\infra\bd.ps1 psql                # consola SQL
  .\infra\bd.ps1 reset -Confirmar    # BORRA, recrea, migra y siembra
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('up','down','status','logs','psql','crear','migrate','seed','reset')]
  [string]$Accion = 'status',

  [ValidateSet('auto','nativo','docker')]
  [string]$Modo = 'auto',

  # Salta la confirmacion de 'reset'. Necesario para ejecutarlo desde un script
  # o un agente, donde no hay teclado que responda al Read-Host.
  [switch]$Confirmar
)

$ErrorActionPreference = 'Stop'

# Raiz del repo: este script esta en infra/, un nivel por debajo.
$Raiz = Split-Path $PSScriptRoot -Parent
Set-Location $Raiz

# Credenciales de DESARROLLO. Son las mismas que usa el CI y las que trae por
# defecto drizzle.config.ts. No valen para produccion y no son ningun secreto.
$Usuario  = 'erp'
$Clave    = 'erp'
$Base     = 'erp_dev'
$Puerto   = 5432
$Servicio = 'postgresql-x64-16'

# El compose del repo declara el servicio como "db" y no fija container_name.
$Compose     = 'infra/docker/docker-compose.yml'
$ServicioDoc = 'db'

# ---------------------------------------------------------------- deteccion
function Detectar-Modo {
  if ($Modo -ne 'auto') { return $Modo }
  if (Get-Service $Servicio -ErrorAction SilentlyContinue) { return 'nativo' }
  if ((Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path $Compose)) { return 'docker' }
  Write-Host "No encuentro ni Postgres nativo ni Docker." -ForegroundColor Red
  Write-Host "  nativo: winget install PostgreSQL.PostgreSQL.16"
  Write-Host "  docker: hace falta WSL (wsl --install, como administrador, y reiniciar)"
  exit 1
}
$motor = Detectar-Modo

function Docker-Compose { docker compose -f $Compose @args }

# psql.exe no entra en el PATH en la instalacion nativa.
function Ruta-Psql {
  $c = Get-Command psql -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending |
       ForEach-Object { Join-Path $_.FullName 'bin\psql.exe' } |
       Where-Object { Test-Path $_ } |
       Select-Object -First 1
  if (-not $p) { Write-Host "No encuentro psql.exe" -ForegroundColor Red; exit 1 }
  return $p
}

# Ejecuta SQL. -ComoSuper usa el superusuario postgres en vez del rol erp.
function Sql {
  param([string]$Consulta, [switch]$ComoSuper, [switch]$Callado)
  $usr = if ($ComoSuper) { 'postgres' } else { $Usuario }
  $bd  = if ($ComoSuper) { 'postgres' } else { $Base }
  $extra = if ($Callado) { @('-tA') } else { @() }
  if ($motor -eq 'nativo') {
    $env:PGPASSWORD = $Clave
    & (Ruta-Psql) -h localhost -p $Puerto -U $usr -d $bd -v ON_ERROR_STOP=1 @extra -c $Consulta
  } else {
    Docker-Compose exec -T $ServicioDoc psql -U $usr -d $bd -v ON_ERROR_STOP=1 @extra -c $Consulta
  }
}

function Esperar-Conexion {
  Write-Host "Esperando a Postgres..." -NoNewline
  for ($i = 0; $i -lt 60; $i++) {
    if ($motor -eq 'nativo') {
      $env:PGPASSWORD = $Clave
      & (Ruta-Psql) -h localhost -p $Puerto -U postgres -d postgres -c 'select 1' *> $null
      if ($LASTEXITCODE -eq 0) { Write-Host " listo." -ForegroundColor Green; return }
    } else {
      # Sin container_name fijo, se pregunta al propio compose por el contenedor.
      $cid = (Docker-Compose ps -q $ServicioDoc 2>$null)
      if ($cid) {
        $salud = (docker inspect --format '{{.State.Health.Status}}' $cid 2>$null)
        if ($salud -eq 'healthy') { Write-Host " listo." -ForegroundColor Green; return }
      }
    }
    Start-Sleep -Seconds 1; Write-Host "." -NoNewline
  }
  Write-Host ""
  Write-Host "Postgres no responde. Mira: .\infra\bd.ps1 logs" -ForegroundColor Red
  exit 1
}

Write-Host "[motor: $motor | raiz: $Raiz]" -ForegroundColor DarkGray

switch ($Accion) {
  'up' {
    if ($motor -eq 'nativo') {
      if ((Get-Service $Servicio).Status -ne 'Running') { Start-Service $Servicio }
    } else {
      Docker-Compose up -d $ServicioDoc
    }
    Esperar-Conexion
    Write-Host "DATABASE_URL=postgres://${Usuario}:${Clave}@localhost:${Puerto}/${Base}"
  }

  'crear' {
    Esperar-Conexion
    $hayRol = Sql -ComoSuper -Callado "select 1 from pg_roles where rolname='$Usuario'"
    if ($hayRol -match '1') {
      Write-Host "El rol '$Usuario' ya existe."
    } else {
      Sql -ComoSuper "CREATE ROLE $Usuario LOGIN PASSWORD '$Clave' CREATEDB;"
      Write-Host "Rol '$Usuario' creado." -ForegroundColor Green
    }
    # TEMPLATE template0 + LC_COLLATE 'C' para ordenar igual que el CI, que
    # levanta el contenedor con --locale=C. Sin template0 Postgres no permite
    # cambiar la collation y heredaria la del sistema.
    $hayBase = Sql -ComoSuper -Callado "select 1 from pg_database where datname='$Base'"
    if ($hayBase -match '1') {
      Write-Host "La base '$Base' ya existe."
    } else {
      Sql -ComoSuper "CREATE DATABASE $Base OWNER $Usuario ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"
      Write-Host "Base '$Base' creada." -ForegroundColor Green
    }
    Write-Host "DATABASE_URL=postgres://${Usuario}:${Clave}@localhost:${Puerto}/${Base}"
  }

  'down' {
    if ($motor -eq 'nativo') { Stop-Service $Servicio } else { Docker-Compose down }
  }

  'status' {
    if ($motor -eq 'nativo') {
      Get-Service $Servicio | Format-Table Status, Name, DisplayName -AutoSize
    } else {
      Docker-Compose ps
    }
    Sql -ComoSuper "select datname, pg_size_pretty(pg_database_size(datname)) as tamano from pg_database where datistemplate = false;"
  }

  'logs' {
    if ($motor -eq 'nativo') {
      $log = Get-ChildItem 'C:\Program Files\PostgreSQL\16\data\log' -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($log) { Get-Content $log.FullName -Tail 40 } else { Write-Host "Sin archivos de log." }
    } else {
      Docker-Compose logs -f $ServicioDoc
    }
  }

  'psql' {
    if ($motor -eq 'nativo') {
      $env:PGPASSWORD = $Clave
      & (Ruta-Psql) -h localhost -p $Puerto -U $Usuario -d $Base
    } else {
      Docker-Compose exec $ServicioDoc psql -U $Usuario -d $Base
    }
  }

  'migrate' {
    & $PSCommandPath up -Modo $motor
    npm run build:packages
    npm run db:migrate
  }

  'seed' {
    & $PSCommandPath up -Modo $motor
    npm run db:seed
  }

  'reset' {
    Write-Host "Esto BORRA la base '$Base' entera." -ForegroundColor Yellow
    if (-not $Confirmar) {
      if ((Read-Host "Escribe 'si' para continuar") -ne 'si') { Write-Host "Cancelado."; exit 0 }
    }
    Esperar-Conexion
    Sql -ComoSuper "DROP DATABASE IF EXISTS $Base WITH (FORCE);"
    Sql -ComoSuper "CREATE DATABASE $Base OWNER $Usuario ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"
    npm run build:packages
    npm run db:migrate
    # Sin seed no hay empresa y la API responde 500 a todo. Un reset que deja
    # el ERP inutilizable no es un reset util.
    npm run db:seed
    Write-Host "Base recreada, migrada y sembrada." -ForegroundColor Green
  }
}
