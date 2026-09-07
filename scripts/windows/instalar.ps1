# Instalación desde cero. Se ejecuta una sola vez.
#
#   .\scripts\windows\instalar.ps1 -Empresa "DINTEL ARQUITECTURA INTEGRAL, S.A.U." -Nif "A12345674" -AdminEmail "victor@dintel.es" -AdminNombre "Victor"
#
# Deja el sistema listo para entrar: base de datos creada y migrada, empresa
# dada de alta y un usuario de Dirección con el que iniciar sesión.
#
# Es seguro repetirlo: no toca una base de datos que ya tenga datos.

param(
  [string]$Empresa     = '',
  [string]$Nif         = '',
  [string]$AdminEmail  = '',
  [string]$AdminNombre = 'Dirección',
  [string]$BdUsuario   = 'erp',
  [string]$BdPassword  = '',
  [string]$BdNombre    = 'erp_dev'
)

. (Join-Path $PSScriptRoot 'entorno.ps1')
Set-Location $ErpRaiz

Write-Host ""
Write-Host "== Instalación del ERP ==" -ForegroundColor Cyan
Write-Host ""

# 1. Cluster de PostgreSQL --------------------------------------------------
if (-not (Test-Path $ErpPgDataDir)) {
  Write-Host "[1/6] Creando la base de datos en $ErpPgDataDir"
  # La contraseña del superusuario se guarda en un fichero temporal porque
  # initdb no la acepta por parámetro; se borra en cuanto termina.
  $tmp = [System.IO.Path]::GetTempFileName()
  $superPass = [System.Guid]::NewGuid().ToString('N')
  Set-Content -Path $tmp -Value $superPass -NoNewline -Encoding ascii
  try {
    & (Join-Path $ErpPgDir 'bin\initdb.exe') `
      -D $ErpPgDataDir -U postgres --pwfile=$tmp --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw "initdb ha fallado" }
    Write-Host "      Contraseña del superusuario postgres: $superPass" -ForegroundColor Yellow
    Write-Host "      Anótala: no vuelve a mostrarse." -ForegroundColor Yellow
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "[1/6] La base de datos ya existía en $ErpPgDataDir"
}

# 2. Arranque ---------------------------------------------------------------
Write-Host "[2/6] Arrancando PostgreSQL"
& (Join-Path $PSScriptRoot 'arrancar-bd.ps1')

# 3. Usuario y base del ERP -------------------------------------------------
if (-not $BdPassword) {
  $BdPassword = [System.Guid]::NewGuid().ToString('N').Substring(0, 20)
}
Write-Host "[3/6] Creando el usuario y la base del ERP"
$env:PGPASSWORD = $BdPassword
$existe = & (Join-Path $ErpPgDir 'bin\psql.exe') -U $BdUsuario -d $BdNombre -tAc "select 1" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "      Ya existían: se conservan."
} else {
  Write-Host "      Hace falta la contraseña del superusuario «postgres»."
  $env:PGPASSWORD = Read-Host "      Contraseña de postgres"
  $sql = "create role $BdUsuario with login password '$BdPassword'; create database $BdNombre owner $BdUsuario;"
  & (Join-Path $ErpPgDir 'bin\psql.exe') -U postgres -d postgres -c $sql
  if ($LASTEXITCODE -ne 0) {
    Write-Host "      No se han podido crear. Si ya existían, vuelve a lanzarlo con -BdPassword <la que tengan>." -ForegroundColor Red
    exit 1
  }
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# 4. Fichero .env -----------------------------------------------------------
$envPath = Join-Path $ErpRaiz '.env'
if (Test-Path $envPath) {
  Write-Host "[4/6] El fichero .env ya existía: no se toca"
} else {
  Write-Host "[4/6] Escribiendo .env"
  $secreto = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
  @(
    "DATABASE_URL=postgres://${BdUsuario}:${BdPassword}@localhost:5432/${BdNombre}",
    "API_PORT=3001",
    "JWT_SECRET=$secreto"
  ) | Set-Content -Path $envPath -Encoding utf8
  Write-Host "      Creado. Contiene la contraseña de la base: no lo subas a ningún sitio." -ForegroundColor Yellow
}

# 5. Dependencias y compilación ---------------------------------------------
Write-Host "[5/6] Instalando dependencias (tarda unos minutos)"
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install ha fallado." -ForegroundColor Red; exit 1 }
npm run build:packages
if ($LASTEXITCODE -ne 0) { Write-Host "La compilación ha fallado." -ForegroundColor Red; exit 1 }

# 6. Migraciones y datos iniciales ------------------------------------------
Write-Host "[6/6] Creando las tablas y la empresa"
npm run db:migrate
if ($LASTEXITCODE -ne 0) { Write-Host "Las migraciones han fallado." -ForegroundColor Red; exit 1 }

if ($Empresa)     { $env:SEED_COMPANY_NAME  = $Empresa }
if ($Nif)         { $env:SEED_COMPANY_TAXID = $Nif }
if ($AdminEmail)  { $env:SEED_ADMIN_EMAIL   = $AdminEmail }
if ($AdminNombre) { $env:SEED_ADMIN_NAME    = $AdminNombre }
npm run db:seed
$seedOk = ($LASTEXITCODE -eq 0)
'SEED_COMPANY_NAME','SEED_COMPANY_TAXID','SEED_ADMIN_EMAIL','SEED_ADMIN_NAME' |
  ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
if (-not $seedOk) { Write-Host "El alta inicial ha fallado." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Instalación terminada." -ForegroundColor Green
Write-Host "Anota la contraseña que acaba de imprimirse arriba: no vuelve a mostrarse."
Write-Host ""
Write-Host "Comprueba el estado con:  npm run doctor"
Write-Host "Arranca el sistema con:   .\scripts\windows\arrancar.ps1"
Write-Host ""
