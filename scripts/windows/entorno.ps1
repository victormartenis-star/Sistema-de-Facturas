# Rutas y comprobaciones comunes a todos los scripts.
#
# Este PC no tiene permisos de administrador, así que Node y PostgreSQL son
# portables y no están en el Path del sistema: cada sesión de PowerShell tiene
# que añadirlos. Se hace aquí una sola vez y el resto de scripts lo cargan con
# `. .\entorno.ps1`.
#
# Si mueves las carpetas, cambia solo estas tres líneas.

$ErrorActionPreference = 'Stop'

$Global:ErpNodeDir   = $env:ERP_NODE_DIR   ; if (-not $ErpNodeDir)   { $Global:ErpNodeDir   = 'C:\Users\Victor\Tools\node-v24.18.0-win-x64' }
$Global:ErpPgDir     = $env:ERP_PG_DIR     ; if (-not $ErpPgDir)     { $Global:ErpPgDir     = 'C:\Users\Victor\Tools\pgsql' }
$Global:ErpPgDataDir = $env:ERP_PG_DATA_DIR; if (-not $ErpPgDataDir) { $Global:ErpPgDataDir = 'C:\Users\Victor\Tools\pgdata-erp' }

# La raíz del proyecto es dos carpetas por encima de este script.
$Global:ErpRaiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Confirmar-Carpeta($ruta, $que, $pista) {
  if (-not (Test-Path $ruta)) {
    Write-Host ""
    Write-Host "No encuentro $que en:" -ForegroundColor Red
    Write-Host "  $ruta"
    Write-Host $pista
    Write-Host ""
    exit 1
  }
}

Confirmar-Carpeta $ErpNodeDir 'Node.js' 'Descomprime Node portable ahí, o define la variable ERP_NODE_DIR con la ruta correcta.'
Confirmar-Carpeta (Join-Path $ErpPgDir 'bin') 'PostgreSQL' 'Descomprime PostgreSQL portable ahí, o define la variable ERP_PG_DIR.'

# Se añaden al principio del Path para que ganen a cualquier otra versión.
$env:Path = "$ErpNodeDir;$(Join-Path $ErpPgDir 'bin');$env:Path"

function Bd-Arrancada {
  # pg_isready devuelve 0 cuando la base acepta conexiones.
  & (Join-Path $ErpPgDir 'bin\pg_isready.exe') -h localhost -p 5432 *> $null
  return ($LASTEXITCODE -eq 0)
}
