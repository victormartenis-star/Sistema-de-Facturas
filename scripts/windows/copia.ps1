# Copia de seguridad de la base de datos.
#
#   .\scripts\windows\copia.ps1
#
# Hazla antes de cada actualización y, con datos de verdad dentro, una vez al
# día. Copia el fichero resultante a otro sitio: una copia en el mismo disco
# que el original no es una copia de seguridad.

. (Join-Path $PSScriptRoot 'entorno.ps1')
Set-Location $ErpRaiz

& (Join-Path $PSScriptRoot 'arrancar-bd.ps1')
if ($LASTEXITCODE -ne 0) { exit 1 }

npm run copia:crear
