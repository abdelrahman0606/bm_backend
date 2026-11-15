@echo off
setlocal

rem ---------------------------------------------------------------------------
rem Starts the local MongoDB that the Time Management feature reads and writes.
rem
rem Development convenience for Windows only: a portable mongod, no installer
rem and no administrator rights. The production Linux server runs MongoDB as a
rem systemd service instead - see DUAL_DATABASE_SETUP.md.
rem
rem It is a single-node replica set on purpose: the usage-sync endpoint writes
rem the batch record and the daily totals in one transaction, and transactions
rem need a replica set. The set is initiated once, by
rem scripts\init-local-mongod-replicaset.js.
rem
rem Bound to the loopback interface only: never reachable from the network.
rem ---------------------------------------------------------------------------

set "MONGO_ROOT=D:\mongodb-portable"
set "MONGO_DATA=D:\mongodb-data"
set "MONGO_HOME="

rem Resolve whichever MongoDB version is extracted under MONGO_ROOT.
for /d %%d in ("%MONGO_ROOT%\mongodb-win32-*") do set "MONGO_HOME=%%d"

if not defined MONGO_HOME (
  echo [start-local-mongod] No MongoDB found under %MONGO_ROOT%.
  echo [start-local-mongod] Extract the MongoDB Windows archive there first.
  exit /b 1
)

if not exist "%MONGO_DATA%\db" mkdir "%MONGO_DATA%\db"
if not exist "%MONGO_DATA%\log" mkdir "%MONGO_DATA%\log"

echo [start-local-mongod] mongod:  %MONGO_HOME%\bin\mongod.exe
echo [start-local-mongod] dbpath:  %MONGO_DATA%\db
echo [start-local-mongod] logpath: %MONGO_DATA%\log\mongod.log
echo [start-local-mongod] listening on 127.0.0.1:27017, replica set rs-tm
echo.

"%MONGO_HOME%\bin\mongod.exe" ^
  --dbpath "%MONGO_DATA%\db" ^
  --logpath "%MONGO_DATA%\log\mongod.log" ^
  --bind_ip 127.0.0.1 ^
  --port 27017 ^
  --replSet rs-tm

endlocal
