param(
    [Parameter(Mandatory = $true)]
    [string]$FunctionName,
    [string]$Region = "",
    [string]$Profile = "",
    [string]$ApiDir = "",
    [switch]$Publish,
    [switch]$NoWait
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

if (-not $ApiDir) {
    $ApiDir = Join-Path $repoRoot "api"
}

if (-not (Test-Path $ApiDir)) {
    throw "API directory not found: $ApiDir"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI not found. Install/configure AWS CLI first."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mangahub-api-" + [guid]::NewGuid().ToString("N"))
$stagingDir = Join-Path $tempRoot "package"
$zipPath = Join-Path $tempRoot "api-deploy.zip"

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

try {
    Copy-Item -Path (Join-Path $ApiDir "*") -Destination $stagingDir -Recurse -Force

    Get-ChildItem -Path $stagingDir -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Get-ChildItem -Path $stagingDir -Recurse -Include "*.pyc","*.pyo" -File -ErrorAction SilentlyContinue | Remove-Item -Force

    Compress-Archive -Path (Join-Path $stagingDir "*") -DestinationPath $zipPath -Force

    $updateArgs = @(
        "lambda", "update-function-code",
        "--function-name", $FunctionName,
        "--zip-file", ("fileb://{0}" -f $zipPath)
    )
    if ($Region) {
        $updateArgs += @("--region", $Region)
    }
    if ($Profile) {
        $updateArgs += @("--profile", $Profile)
    }
    if ($Publish) {
        $updateArgs += "--publish"
    }

    Write-Host "Updating Lambda code for '$FunctionName'..."
    & aws @updateArgs
    if ($LASTEXITCODE -ne 0) {
        throw "aws lambda update-function-code failed."
    }

    if (-not $NoWait) {
        $waitArgs = @("lambda", "wait", "function-updated", "--function-name", $FunctionName)
        if ($Region) {
            $waitArgs += @("--region", $Region)
        }
        if ($Profile) {
            $waitArgs += @("--profile", $Profile)
        }

        Write-Host "Waiting for function update to complete..."
        & aws @waitArgs
        if ($LASTEXITCODE -ne 0) {
            throw "aws lambda wait function-updated failed."
        }
    }

    Write-Host "Deploy complete."
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force
    }
}
