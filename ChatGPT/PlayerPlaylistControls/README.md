# Player Playlist Controls

Stash 영상 플레이어의 재생바에 반복·랜덤 플리·외부 재생 버튼을 추가합니다. 별도 라이브러리는 필요하지 않습니다.

- **Repeat ON / Repeat OFF**: 현재 영상을 처음부터 반복합니다. ON일 때는 대기열의 `Continue`가 켜져 있어도 다음 영상으로 넘어가지 않습니다. 상태는 브라우저에 저장됩니다.
- **폴더 플리**: 현재 영상의 기본 원본 파일과 **같은 폴더**에 있는 영상을 랜덤 순서로 재생합니다. 하위 폴더는 제외합니다.
- **캐릭터 플리**: 현재 영상에 등록된 배우의 출연작을 랜덤 순서로 재생합니다. 배우가 여럿이면 그중 한 명 이상이 출연하는 영상을 모두 포함합니다. 등록된 배우가 없으면 안내를 표시합니다.
- **외부 재생**: 기본 원본 파일을 PotPlayer·VLC 등 설정한 외부 플레이어로 엽니다. 외부 플레이어 실행에 성공하면 브라우저 재생을 일시정지합니다.

**파일 정보** 탭의 원본 경로도 클릭하거나 키보드 Enter/Space로 외부 재생할 수 있습니다. 원본이 여러 개이면 각 경로에 해당하는 파일을 엽니다. 파일 탐색기에서 위치를 여는 기존 버튼도 사용할 수 있습니다.

플리 버튼을 누르면 Repeat를 OFF로 바꾸고, 첫 랜덤 영상부터 Stash 기본 대기열로 연속 재생합니다. 현재 영상도 후보에 포함되며, 한 번 만든 대기열의 랜덤 순서는 끝까지 유지됩니다. 플리 버튼을 다시 누르면 순서를 새로 섞습니다. 대기열 마지막 영상에서 재생을 마칩니다.

## 적용

이 폴더를 Stash의 플러그인 경로 안에 둔 뒤 **설정 → 플러그인 → 플러그인 새로고침**을 실행하고 브라우저 페이지를 새로고침합니다. 이미 이 작업 폴더가 플러그인 경로 안에 있으면 복사할 필요가 없습니다. `Player Playlist Controls`를 활성화하면 됩니다.

`Ultimate Queue And Preview`의 Continue 자동 활성화 기능과 함께 사용할 수 있습니다. 짧은 영상 자동 반복 설정은 이 플러그인의 Repeat 상태를 따릅니다.

Stash UI Plugin API의 `ScenePlayer` 패치와 `InteractiveUtils.getPlayer()`를 사용합니다. 개발 환경의 Stash 버전은 `v0.31.1-153-g6ba61d79`입니다.

## 외부 플레이어 설정

**설정 → 플러그인 → Player Playlist Controls → 외부 플레이어 실행 파일 경로**에 실행 파일의 전체 경로를 지정합니다. 예: `C:\Program Files\DAUM\PotPlayer\PotPlayer64.exe`. 실행 옵션은 붙이지 않습니다.

이 설정을 비워 두면 `stashOpenMediaPlayer`에 저장된 `mediaPlayerPath`를 사용하므로 기존 설정으로 바로 동작합니다. 외부 플레이어는 **Stash 서버가 실행 중인 Windows PC**에서 열립니다. 브라우저를 다른 기기에서 열어도 실행 위치는 같습니다.

Windows PowerShell을 사용하며 Python이나 `stashUserscriptLibrary7dJx1qP`는 필요하지 않습니다. 경로를 URL로 변환하지 않으므로 한글·공백·`%`·`#`·괄호를 그대로 전달합니다. 플레이어 실행 실패는 화면에 표시하고 브라우저 재생은 유지합니다. 외부 플레이어 자체의 반복·대기열 동작은 해당 플레이어 설정을 따릅니다.

이 기능은 [7dJx1qP의 stashOpenMediaPlayer](https://github.com/7dJx1qP/stash-plugins#stash-open-media-player)의 동작을 참고해 현재 Stash API에 맞게 새로 작성했습니다. 예전의 영문 `Path` XPath 및 파일 링크 의존성을 제거하고 `SceneFileInfoPanel`·`TruncatedText` 패치를 사용합니다.

## 검증

프런트엔드: `node --test PlayerPlaylistControls/tests/*.test.cjs`

Windows 실행부는 `tests/open-media-player.test.ps1`로 검증합니다. 로컬 스크립트 실행이 허용된 환경에서는 `powershell.exe -NoProfile -File PlayerPlaylistControls/tests/open-media-player.test.ps1`을 실행합니다. 실행 정책을 바꾸지 않고 검증하려면 PowerShell에서 다음 명령을 사용합니다.

```powershell
$testDir = (Resolve-Path PlayerPlaylistControls/tests).Path
$testPath = (Join-Path $testDir open-media-player.test.ps1).Replace("'", "''")
$testCommand = "& ([scriptblock]::Create([IO.File]::ReadAllText('$testPath'))) -TestDirectory '$($testDir.Replace("'", "''"))'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($testCommand))
& powershell.exe -NoProfile -NonInteractive -EncodedCommand $encoded
```

실행부 테스트는 실제 영상을 열지 않고 임시 테스트 프로그램으로 원본 경로가 정확히 한 인수로 전달되는지 확인합니다.
