@echo off
rem Registers the pharmacy agent in Windows Task Scheduler. Run as Administrator from the
rem folder that contains pharmacy_agent.exe and config.json.
set AGENT=%~dp0pharmacy_agent.exe
if not exist "%AGENT%" (
  echo pharmacy_agent.exe not found next to this file
  exit /b 1
)
rem Start with Windows.
schtasks /Create /F /TN "VatanPharmacyAgent" /TR "\"%AGENT%\"" /SC ONSTART /RU SYSTEM /RL HIGHEST
rem Watchdog: every 5 minutes; a second copy exits at once if the agent is already running.
schtasks /Create /F /TN "VatanPharmacyAgentWatchdog" /TR "\"%AGENT%\"" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST
schtasks /Run /TN "VatanPharmacyAgent"
echo Done. Log file: %~dp0pharmacy_agent.log
