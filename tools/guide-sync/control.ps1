param(
    [ValidateSet('Install','Start','Pause','Resume','Status','Uninstall')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
$guideTaskName = 'SkySecure Guide Auto Sync'
$guideNodePath = 'C:\Program Files\nodejs\node.exe'
$guideSyncPath = Join-Path $PSScriptRoot 'sync.mjs'
$guideRunPath = Join-Path $PSScriptRoot 'run.ps1'
$guideMasterPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'SKYSECURE_AI_AGENT_ENGINEERING_AND_PRODUCTION_GUIDE.html'
if (-not (Test-Path -LiteralPath $guideNodePath) -or -not (Test-Path -LiteralPath $guideSyncPath) -or -not (Test-Path -LiteralPath $guideRunPath) -or -not (Test-Path -LiteralPath $guideMasterPath)) {
    throw 'Guide, Node.js, or sync helper is missing. Nothing was registered.'
}
$guideExistingTask = Get-ScheduledTask -TaskName $guideTaskName -ErrorAction SilentlyContinue
if ($guideExistingTask -and -not (($guideExistingTask.Actions.Arguments -like ('*' + $guideSyncPath + '*')) -or ($guideExistingTask.Actions.Arguments -like ('*' + $guideRunPath + '*')))) {
    throw 'A different task already uses this name; it will not be changed.'
}

function Stop-OwnedGuideProcess {
    # Stopping a scheduled PowerShell action can leave its Node child alive.
    # Match the full executable and exact script/argument pair; never stop other Node processes.
    $guideCommandPattern = '^\s*"?' + [regex]::Escape($guideNodePath) + '"?\s+"' + [regex]::Escape($guideSyncPath) + '"\s+--watch\s*$'
    foreach ($guideProcess in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")) {
        if ($guideProcess.ExecutablePath -ieq $guideNodePath -and $guideProcess.CommandLine -match $guideCommandPattern) {
            Stop-Process -Id ([int]$guideProcess.ProcessId) -Force -ErrorAction Stop
        }
    }
}

switch ($Action) {
    'Install' {
        $guideTaskArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $guideRunPath + '"'
        $guideTaskAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $guideTaskArguments -WorkingDirectory $PSScriptRoot
        if (-not $guideExistingTask) {
            $guideIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            $guideTaskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $guideIdentity
            $guideTaskPrincipal = New-ScheduledTaskPrincipal -UserId $guideIdentity -LogonType Interactive -RunLevel Limited
            $guideTaskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
            Register-ScheduledTask -TaskName $guideTaskName -Action $guideTaskAction -Trigger $guideTaskTrigger -Principal $guideTaskPrincipal -Settings $guideTaskSettings -Description 'Publishes only the explicitly selected public HTML guide to the guide-live GitHub Pages source. No agent code or prod branch writes.' | Out-Null
        }
        else {
            Stop-ScheduledTask -TaskName $guideTaskName
            Stop-OwnedGuideProcess
            Set-ScheduledTask -TaskName $guideTaskName -Action $guideTaskAction | Out-Null
        }
        Start-ScheduledTask -TaskName $guideTaskName
        Write-Output 'Guide-only automatic publishing installed for this Windows user and started.'
    }
    'Start' {
        if (-not $guideExistingTask) { throw 'Run Install first.' }
        Start-ScheduledTask -TaskName $guideTaskName
        Write-Output 'Guide sync task started. A persistent pause remains in effect until Resume.'
    }
    'Pause' {
        & $guideNodePath $guideSyncPath --pause
        if ($LASTEXITCODE -ne 0) { throw 'Could not pause sync.' }
        if ($guideExistingTask) { Stop-ScheduledTask -TaskName $guideTaskName }
        Stop-OwnedGuideProcess
        Write-Output 'Guide sync paused. Future local saves will not publish until Resume.'
    }
    'Resume' {
        & $guideNodePath $guideSyncPath --resume
        if ($LASTEXITCODE -ne 0) { throw 'Could not clear the pause.' }
        if (-not $guideExistingTask) { throw 'Run Install to start the resumed sync helper.' }
        Start-ScheduledTask -TaskName $guideTaskName
        Write-Output 'Guide sync resumed; the latest stable local version will be considered for publication.'
    }
    'Status' {
        if ($guideExistingTask) { $guideExistingTask | Select-Object TaskName, State | Format-Table -AutoSize }
        else { Write-Output 'Automatic-start task is not installed.' }
        $guideStatusPattern = '^\s*"?' + [regex]::Escape($guideNodePath) + '"?\s+"' + [regex]::Escape($guideSyncPath) + '"\s+--watch\s*$'
        $guideOwnedProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
            $_.ExecutablePath -ieq $guideNodePath -and $_.CommandLine -match $guideStatusPattern
        })
        if ($guideOwnedProcesses.Count -gt 0) {
            $guideOwnedProcesses | Select-Object @{Name='PublisherProcessId';Expression={$_.ProcessId}}, CreationDate | Format-Table -AutoSize
        }
        else { Write-Output 'The local publisher process is not running.' }
        Write-Output 'Idle sync makes no network checks. State timestamps describe the last meaningful operation, not a heartbeat.'
        & $guideNodePath $guideSyncPath --status
    }
    'Uninstall' {
        & $guideNodePath $guideSyncPath --pause
        if ($LASTEXITCODE -ne 0) { throw 'Could not pause sync safely.' }
        if ($guideExistingTask) {
            Stop-ScheduledTask -TaskName $guideTaskName
            Stop-OwnedGuideProcess
            Unregister-ScheduledTask -TaskName $guideTaskName -Confirm:$false
        }
        else { Stop-OwnedGuideProcess }
        Write-Output 'Guide sync startup removed. The HTML guide and public Git history are preserved.'
    }
}
