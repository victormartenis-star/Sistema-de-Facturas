# Arranca PostgreSQL si no está ya en marcha.
#
# El PostgreSQL portable no se levanta solo al encender el ordenador, así que
# esto hay que hacerlo después de cada reinicio. Es idempotente: si ya está
# arrancado, no hace nada.

. (Join-Path $PSScriptRoot 'entorno.ps1')

if (Bd-Arrancada) {
  Write-Host "PostgreSQL ya estaba en marcha." -ForegroundColor Green
  exit 0
}

Confirmar-Carpeta $ErpPgDataDir 'la carpeta de datos de PostgreSQL' `
  'Si es la primera vez, ejecuta primero: .\instalar.ps1'

Write-Host "Arrancando PostgreSQL..."
& (Join-Path $ErpPgDir 'bin\pg_ctl.exe') `
  -D $ErpPgDataDir `
  -l (Join-Path $ErpPgDataDir 'server.log') `
  -w start

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "No ha arrancado. Mira el final del registro:" -ForegroundColor Red
  Write-Host "  Get-Content '$(Join-Path $ErpPgDataDir 'server.log')' -Tail 30"
  exit 1
}
Write-Host "PostgreSQL en marcha." -ForegroundColor Green
