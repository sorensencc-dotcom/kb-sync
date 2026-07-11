$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "cd C:\dev\kb-sync; npm run kb:sync"
$Trigger = New-ScheduledTaskTrigger -Daily -At 03:00
Register-ScheduledTask -TaskName "KB-Sync-Daily" -Action $Action -Trigger $Trigger -RunLevel Limited -Force
