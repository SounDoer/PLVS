!macro PLVS_BROADCAST_ENVIRONMENT_CHANGE
  System::Call 'user32::SendMessageTimeout(i 0xffff, i ${WM_SETTINGCHANGE}, i 0, t "Environment", i 0, i 5000, *i .r0)'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$installDir = '$INSTDIR'; $$path = [Environment]::GetEnvironmentVariable('Path', 'User'); $$entries = @($$path -split ';' | Where-Object { $$_ -and ($$_.TrimEnd('\') -ine $$installDir.TrimEnd('\')) }); $$entries += $$installDir; [Environment]::SetEnvironmentVariable('Path', ($$entries -join ';'), 'User')"`
  !insertmacro PLVS_BROADCAST_ENVIRONMENT_CHANGE
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$installDir = '$INSTDIR'; $$path = [Environment]::GetEnvironmentVariable('Path', 'User'); $$entries = @($$path -split ';' | Where-Object { $$_ -and ($$_.TrimEnd('\') -ine $$installDir.TrimEnd('\')) }); if ($$entries.Count -eq 0) { [Environment]::SetEnvironmentVariable('Path', $$null, 'User') } else { [Environment]::SetEnvironmentVariable('Path', ($$entries -join ';'), 'User') }"`
  !insertmacro PLVS_BROADCAST_ENVIRONMENT_CHANGE
!macroend
