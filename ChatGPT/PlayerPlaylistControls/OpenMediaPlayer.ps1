$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

try {
    $inputJson = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputJson)) {
        throw 'No plugin input was supplied.'
    }
    $request = $inputJson | ConvertFrom-Json
    $videoPath = [string]$request.args.path
    $mediaPlayerPath = ([string]$request.args.mediaPlayerPath).Trim()

    # Settings are sometimes pasted with the executable path in double quotes.
    if ($mediaPlayerPath.Length -ge 2 -and $mediaPlayerPath[0] -eq '"' -and $mediaPlayerPath[$mediaPlayerPath.Length - 1] -eq '"') {
        $mediaPlayerPath = $mediaPlayerPath.Substring(1, $mediaPlayerPath.Length - 2)
    }
    if ([string]::IsNullOrWhiteSpace($videoPath)) {
        throw 'No original video path was supplied.'
    }
    if ([string]::IsNullOrWhiteSpace($mediaPlayerPath)) {
        throw 'No media player executable path was supplied.'
    }
    if (-not (Test-Path -LiteralPath $videoPath -PathType Leaf)) {
        throw 'The original video file no longer exists at the supplied path.'
    }
    if (-not (Test-Path -LiteralPath $mediaPlayerPath -PathType Leaf)) {
        throw 'The media player executable was not found at the configured path.'
    }

    # Pass a native filename as one argument. Do not URI-decode it or escape
    # percent/hash characters: no command shell is involved in this launch.
    $quotedVideoPath = '"' + $videoPath + '"'
    # The player is interactive; only Stash's PowerShell helper is hidden.
    Start-Process -FilePath $mediaPlayerPath -ArgumentList $quotedVideoPath -WindowStyle Normal -ErrorAction Stop | Out-Null
    [Console]::Out.WriteLine((@{ output = @{ started = $true }; error = $null } | ConvertTo-Json -Compress -Depth 4))
    exit 0
} catch {
    [Console]::Out.WriteLine((@{ output = $null; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 4))
    exit 1
}
