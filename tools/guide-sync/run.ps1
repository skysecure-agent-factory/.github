$ErrorActionPreference = 'Stop'
$guideRunnerNode = 'C:\Program Files\nodejs\node.exe'
$guideRunnerScript = Join-Path $PSScriptRoot 'sync.mjs'
if (-not (Test-Path -LiteralPath $guideRunnerNode) -or -not (Test-Path -LiteralPath $guideRunnerScript)) {
    throw 'Guide sync runtime is missing.'
}
# Give the watcher its own hidden process instead of inheriting a transient console.
$guideRunnerProcess = Start-Process -FilePath $guideRunnerNode -ArgumentList @(('"' + $guideRunnerScript + '"'), '--watch') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$guideRunnerProcess.WaitForExit()
exit $guideRunnerProcess.ExitCode
