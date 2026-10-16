@echo off
REM TakeOff - start the server. First run creates a Python virtual env and installs packages.
cd /d "%~dp0"
set VENV=%LOCALAPPDATA%\TakeOff\venv
if not exist "%VENV%\Scripts\python.exe" (
  echo Setting up Python environment, please wait...
  python -m venv "%VENV%" || goto :error
  "%VENV%\Scripts\python.exe" -m pip install --upgrade pip >nul
  "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt || goto :error
)
echo.
echo  TakeOff is running.  Open:  http://localhost:8000
echo  Colleagues on the office network:  http://%COMPUTERNAME%:8000
echo  Close this window to stop the server.
echo.
start "" http://localhost:8000
"%VENV%\Scripts\python.exe" -m uvicorn server.main:app --host 0.0.0.0 --port 8000
goto :eof
:error
echo Setup failed. Check that Python 3 is installed and you have internet access.
pause
