@echo off
REM One-time setup for Windows. Double-click or run:  setup.bat
setlocal
cd /d "%~dp0"
echo.
echo === Looking for Python 3.12 (3.11 / 3.13 also work; 3.14 does NOT) ===
set PYCMD=
py -3.12 --version >nul 2>&1 && set PYCMD=py -3.12
if not defined PYCMD py -3.11 --version >nul 2>&1 && set PYCMD=py -3.11
if not defined PYCMD py -3.13 --version >nul 2>&1 && set PYCMD=py -3.13
if not defined PYCMD (
  echo.
  echo [ERROR] Python 3.11-3.13 was not found.
  echo Install Python 3.12 from https://www.python.org/downloads/release/python-3120/
  echo ^(tick "Add python.exe to PATH" and "py launcher"^), then run setup.bat again.
  exit /b 1
)
echo Using: %PYCMD%
if exist .venv rmdir /s /q .venv
%PYCMD% -m venv .venv || goto :fail
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip || goto :fail
pip install -r requirements.txt || goto :fail
pip install deepeval==4.3.2 || goto :fail
pip install --no-deps ragas==0.4.3 || goto :fail
pip install -r requirements-eval.txt || goto :fail
python -m playwright install chromium || goto :fail
if not exist .env copy .env.example .env >nul
echo.
echo === Setup finished ===
echo NEXT:  1^) open .env in Notepad and paste your NEW Gemini key after GEMINI_API_KEY=
echo        2^) run   .venv\Scripts\activate   then   python check_setup.py
echo        3^) run   start.bat
exit /b 0
:fail
echo.
echo [ERROR] A step failed - read the message above. Common cause: Python 3.14 (use 3.12).
exit /b 1
