@echo off
chcp 65001 >nul
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    REM Node.js not found. Downloading and installing...
    echo Node.js не знайдено. Завантаження та встановлення...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$url='https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi';" ^
      "$out=\"$env:TEMP\nodejs.msi\";" ^
      "Invoke-WebRequest -Uri $url -OutFile $out;" ^
      "Start-Process msiexec -ArgumentList '/i',$out,'/qn' -Wait;" ^
      "Remove-Item $out;"
    REM Node.js installation finished.
    echo Встановлення Node.js завершено.
)
REM Starting cleanup...
echo Запуск очищення...
node "%~dp0cleaner.js" %*
if %ERRORLEVEL% EQU 0 (
    REM Cleanup finished successfully.
    echo Очищення завершено успішно.
) else (
    REM An error occurred during cleanup. Code %ERRORLEVEL%.
    echo Під час очищення виникла помилка. Код %ERRORLEVEL%.
)
pause
