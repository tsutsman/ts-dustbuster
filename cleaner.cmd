@echo off
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js не знайдено. Завантаження та встановлення...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$url='https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi';" ^
      "$out=\"$env:TEMP\nodejs.msi\";" ^
      "Invoke-WebRequest -Uri $url -OutFile $out;" ^
      "Start-Process msiexec -ArgumentList '/i',$out,'/qn' -Wait;" ^
      "Remove-Item $out;"
)
node "%~dp0cleaner.js"
