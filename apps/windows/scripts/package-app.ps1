[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'apps\windows\dist' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$nodeVersion = (& $node --version).TrimStart('v').Split('.')[0]
if ($LASTEXITCODE -ne 0 -or [int]$nodeVersion -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps\service\dist\server.js'))) { throw 'Run pnpm install --frozen-lockfile and pnpm build first.' }
& dotnet publish "$PSScriptRoot\..\Worklog.App\Worklog.App.csproj" --configfile "$PSScriptRoot\..\NuGet.Config" -c Release -o $output
if ($LASTEXITCODE -ne 0) { throw 'Windows app build failed.' }
$codexBinary = $env:CODEX_BINARY
if (-not $codexBinary) {
    $native = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($native) { $codexBinary = $native.Source }
    else {
        # Resolve the native executable from the CLI's optional npm platform package.
        $cli = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cli) {
            $npmRoot = Split-Path $cli.Source
            $vendorRoots = @(
                (Join-Path $npmRoot 'node_modules\@openai\codex\vendor'),
                (Join-Path $npmRoot 'node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor')
            )
            foreach ($vendorRoot in $vendorRoots) {
                foreach ($relative in @('x86_64-pc-windows-msvc\bin\codex.exe', 'x86_64-pc-windows-msvc\codex\codex.exe')) {
                    $candidate = Join-Path $vendorRoot $relative
                    if (Test-Path -LiteralPath $candidate) { $codexBinary = $candidate; break }
                }
                if ($codexBinary) { break }
            }
        }
    }
}
@{ root = $projectRoot; node = $node; codex = $codexBinary } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'checkout.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $output
if (-not $codexBinary) { Write-Warning 'Native Codex CLI not found. Set CODEX_BINARY to codex.exe and repackage for account limits. Local sessions still collect independently.' }
Write-Output "Built $output\Worklog.exe"
