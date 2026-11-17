[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$SshAlias,
    [Parameter(Mandatory)][ValidatePattern('^/[^"\r\n]*$')][string]$WebDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')][string]$Device
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$publisher = Join-Path $root 'apps\website\publish-activity.py'
$python = & py -3 -c 'import sys; assert sys.version_info >= (3, 8); print(sys.executable)'
if ($LASTEXITCODE -ne 0 -or -not $python) { throw 'Python 3.8 or newer and the Windows Python launcher are required.' }
$pythonWindowless = Join-Path (Split-Path $python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonWindowless)) { throw 'The Python installation is missing pythonw.exe.' }

# Verify the feed and SSH connection before enabling unattended runs.
& $python $publisher $SshAlias $WebDirectory --device $Device
if ($LASTEXITCODE -ne 0) { throw 'Initial Worklog device publish failed.' }

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = "Worklog Website Publisher ($Device)"
$arguments = '"{0}" {1} "{2}" --device {3}' -f $publisher, $SshAlias, $WebDirectory, $Device
$action = New-ScheduledTaskAction -Execute $pythonWindowless -Argument $arguments -WorkingDirectory $root
$recurring = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($recurring, $logon) `
    -Settings $settings -Principal $principal -Description 'Publish GitHub history and aggregate Codex activity from this device to Worklog.' -Force
