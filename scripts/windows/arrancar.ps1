# Arranca el sistema entero: base de datos, API y web.
#
# Deja API y web en dos ventanas aparte para poder cerrarlas por separado y
# leer sus mensajes. La ventana desde la que se lanza queda libre.

. (Join-Path $PSScriptRoot 'entorno.ps1')
Set-Location $ErpRaiz

& (Join-Path $PSScriptRoot 'arrancar-bd.ps1')
if ($LASTEXITCODE -ne 0) { exit 1 }

# La API sirve el JavaScript ya compilado de packages/*: si se ha cambiado
# algo ahí y no se recompila, arranca con la versión vieja sin avisar.
Write-Host "Compilando los paquetes compartidos..."
npm run build:packages
if ($LASTEXITCODE -ne 0) { Write-Host "La compilación ha fallado." -ForegroundColor Red; exit 1 }

Write-Host "Arrancando la API (puerto 3001)..."
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "`$env:Path='$ErpNodeDir;'+`$env:Path; Set-Location '$ErpRaiz'; npm run dev:api"
)

Write-Host "Arrancando la web (puerto 3000)..."
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "`$env:Path='$ErpNodeDir;'+`$env:Path; Set-Location '$ErpRaiz'; npm run dev:web"
)

Write-Host ""
Write-Host "Listo. Abre http://localhost:3000 en el navegador." -ForegroundColor Green
Write-Host "La web tarda unos segundos la primera vez."
Write-Host ""
Write-Host "Para parar: cierra las dos ventanas y ejecuta .\scripts\windows\parar-bd.ps1"
