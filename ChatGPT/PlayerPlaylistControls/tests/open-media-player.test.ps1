# Builds a standalone .NET Framework executable in a child Windows PowerShell
# 5.1 process. The fixture only records argv; it never plays media.
# Optional: -StashUrl http://localhost:6974/graphql validates the live plugin
# operation after reloading the plugin in Stash.
#requires -Version 5.1
param([string]$StashUrl, [string]$TestDirectory = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$backendPath = [IO.Path]::GetFullPath((Join-Path $TestDirectory '..\OpenMediaPlayer.ps1'))
$fixtureDir = Join-Path $TestDirectory ('.open-media-player-test-' + [Guid]::NewGuid().ToString('N'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
$script:passed = 0
$testFailure = $null

function Assert-True($condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function Invoke-Backend([string]$json) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $backendCommand = "`$ProgressPreference = 'SilentlyContinue'; & ([scriptblock]::Create([IO.File]::ReadAllText('" + $backendPath.Replace("'", "''") + "')))"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($backendCommand))
    $startInfo.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $encodedCommand
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = $utf8
    $startInfo.StandardErrorEncoding = $utf8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $bytes = $utf8.GetBytes($json)
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            throw 'Backend did not return promptly after launching the fixture.'
        }
        $text = $stdout.Result
        $errorText = $stderr.Result
        Assert-True ([string]::IsNullOrWhiteSpace($errorText)) ('Unexpected stderr: ' + $errorText)
        return @{ code = $process.ExitCode; data = ($text | ConvertFrom-Json) }
    } finally {
        $process.Dispose()
    }
}

function Invoke-Request($request) {
    return Invoke-Backend ($request | ConvertTo-Json -Compress -Depth 5)
}

function Assert-RecordedArguments([string]$videoPath) {
    $recordPath = $videoPath + '.recorded.txt'
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while (-not (Test-Path -LiteralPath $recordPath) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 25
    }
    Assert-True (Test-Path -LiteralPath $recordPath -PathType Leaf) 'The fixture never recorded its arguments.'
    $record = [IO.File]::ReadAllLines($recordPath, $utf8)
    Assert-True ($record.Length -eq 2 -and $record[0] -eq '1') 'The media filename must be exactly one process argument.'
    Assert-True ($record[1] -ceq $videoPath) 'The original filename changed between the API input and process argv.'
}

function Assert-SuccessfulLaunch([string]$videoPath, [string]$playerSetting) {
    $result = Invoke-Request @{ args = @{ path = $videoPath; mediaPlayerPath = $playerSetting } }
    Assert-True ($result.code -eq 0) ('Launch failed: ' + $result.data.error)
    Assert-True ($result.data.output.started -eq $true) 'Success output must report started=true.'
    Assert-True ($null -eq $result.data.error) 'Success output must not contain an error.'
    Assert-RecordedArguments $videoPath
}

function Assert-Rejected($request) {
    $result = Invoke-Request $request
    Assert-True ($result.code -eq 1) 'Invalid launch input must return exit code 1.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($result.data.error)) 'Invalid launch input must return a structured error.'
    Assert-True ($null -eq $result.data.output) 'A rejected launch must not report success.'
}

try {
    [void](New-Item -ItemType Directory -Path $fixtureDir)
    $playerPath = Join-Path $fixtureDir 'fixture player (test) % #.exe'
    $fixtureSource = Join-Path $fixtureDir 'RecordMediaArguments.cs'
    [IO.File]::WriteAllText($fixtureSource, @'
using System;
using System.IO;
using System.Text;
public static class RecordMediaArguments {
    public static void Main(string[] args) {
        if (args.Length == 0) Environment.Exit(2);
        File.WriteAllLines(args[0] + ".recorded.txt", new string[] {
            args.Length.ToString(), String.Join("\n", args)
        }, new UTF8Encoding(false));
    }
}
'@, $utf8)
    # Add-Type can load and lock its output assembly. Compile in a separate
    # process so the fixture is unlocked before the tests and cleanup begin.
    $compileCommand = "`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'; Add-Type -Path '" + $fixtureSource.Replace("'", "''") + "' -OutputAssembly '" + $playerPath.Replace("'", "''") + "' -OutputType ConsoleApplication"
    $compileEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($compileCommand))
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -EncodedCommand $compileEncoded
    Assert-True ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $playerPath -PathType Leaf)) 'Could not compile the argument recorder fixture.'

    $unicode = [string][char]0xD55C + [char]0xAE00
    $videoPath = Join-Path $fixtureDir ('clip [01] 100% # (' + $unicode + ').mp4')
    [IO.File]::WriteAllBytes($videoPath, [byte[]]@())
    Assert-SuccessfulLaunch $videoPath $playerPath
    $script:passed += 1
    Write-Output 'PASS: native argv preserves spaces, brackets, %, #, parentheses and Unicode.'

    $secondPath = Join-Path $fixtureDir ('quoted player (' + $unicode + ').mp4')
    [IO.File]::WriteAllBytes($secondPath, [byte[]]@())
    Assert-SuccessfulLaunch $secondPath ('  "' + $playerPath + '"  ')
    $script:passed += 1
    Write-Output 'PASS: surrounding quotes and whitespace in the executable setting are accepted.'

    Assert-Rejected @{ args = @{ path = (Join-Path $fixtureDir 'missing.mp4'); mediaPlayerPath = $playerPath } }
    $script:passed += 1
    Write-Output 'PASS: a nonexistent video is rejected.'

    Assert-Rejected @{ args = @{ path = $videoPath; mediaPlayerPath = (Join-Path $fixtureDir 'missing.exe') } }
    $script:passed += 1
    Write-Output 'PASS: a nonexistent player is rejected.'

    Assert-Rejected @{ args = @{ path = $fixtureDir; mediaPlayerPath = $playerPath } }
    Assert-Rejected @{ args = @{ path = $videoPath; mediaPlayerPath = $fixtureDir } }
    $script:passed += 1
    Write-Output 'PASS: directories cannot be used as media or executables.'

    Assert-Rejected @{ args = @{ mediaPlayerPath = $playerPath } }
    Assert-Rejected @{ args = @{ path = $videoPath } }
    $script:passed += 1
    Write-Output 'PASS: missing media and player arguments are rejected.'

    $malformed = Invoke-Backend '{invalid json'
    Assert-True ($malformed.code -eq 1 -and $malformed.data.error) 'Malformed input must produce structured JSON error output.'
    $script:passed += 1
    Write-Output 'PASS: malformed JSON produces a structured error.'

    if (-not [string]::IsNullOrWhiteSpace($StashUrl)) {
        $integrationVideo = Join-Path $fixtureDir ('Stash integration [02] 100% # (' + $unicode + ').mp4')
        [IO.File]::WriteAllBytes($integrationVideo, [byte[]]@())
        $body = @{
            query = 'mutation OpenMediaPlayerIntegration($args: Map!) { runPluginOperation(plugin_id: "PlayerPlaylistControls", args: $args) }'
            variables = @{ args = @{ path = $integrationVideo; mediaPlayerPath = $playerPath } }
        } | ConvertTo-Json -Compress -Depth 5
        $response = Invoke-RestMethod -Uri $StashUrl -Method Post -ContentType 'application/json; charset=utf-8' -Body $utf8.GetBytes($body) -TimeoutSec 10
        Assert-True (-not $response.errors) ('Stash operation returned errors: ' + ($response.errors | ConvertTo-Json -Compress))
        Assert-True ($response.data.runPluginOperation.started -eq $true) 'The live Stash operation must report started=true.'
        Assert-RecordedArguments $integrationVideo
        $script:passed += 1
        Write-Output 'PASS: live Stash raw operation preserves the original filename in process argv.'
    }
    Write-Output ($script:passed.ToString() + ' backend tests passed.')
} catch {
    $testFailure = $_
} finally {
    try {
        if (Test-Path -LiteralPath $fixtureDir) {
            $resolvedTestDir = [IO.Path]::GetFullPath($fixtureDir)
            $expectedRoot = [IO.Path]::GetFullPath($TestDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
            if (-not $resolvedTestDir.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Refusing to remove a fixture directory outside the tests workspace.'
            }
            for ($attempt = 0; $attempt -lt 5; $attempt++) {
                try {
                    Remove-Item -LiteralPath $resolvedTestDir -Recurse -Force
                    break
                } catch {
                    if ($attempt -eq 4) { throw }
                    Start-Sleep -Milliseconds 50
                }
            }
        }
    } catch {
        if ($null -eq $testFailure) {
            $testFailure = $_
        } else {
            [Console]::Error.WriteLine('Fixture cleanup also failed: ' + $_.Exception.Message)
        }
    }
}

if ($null -ne $testFailure) { throw $testFailure }
