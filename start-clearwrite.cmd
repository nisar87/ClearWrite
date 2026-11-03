@echo off
setlocal
cd /d "%~dp0"
if not defined CLEARWRITE_DATA_DIR set "CLEARWRITE_DATA_DIR=%~dp0data"
if not defined electron_config_cache set "electron_config_cache=%~dp0cache\electron"
call npm start
