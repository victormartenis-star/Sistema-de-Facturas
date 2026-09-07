# Para PostgreSQL de forma ordenada.
#
# Apagar el ordenador sin parar la base no suele romper nada —Postgres se
# recupera solo al arrancar— pero hacerlo bien evita el arranque lento y los
# sustos con el fichero de bloqueo.

. (Join-Path $PSScriptRoot 'entorno.ps1')

if (-not (Bd-Arrancada)) {
  Write-Host "PostgreSQL no estaba en marcha."
  exit 0
}

& (Join-Path $ErpPgDir 'bin\pg_ctl.exe') -D $ErpPgDataDir -w stop
Write-Host "PostgreSQL parado." -ForegroundColor Green
