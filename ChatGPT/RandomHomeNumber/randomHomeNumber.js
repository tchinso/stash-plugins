// randomHomeNumber.js
// 어디서나 잘 보이게, 작은 팝업 형태로 1~5 랜덤 숫자 표시

(function() {
  // 홈 화면인지 확인
  function isHomePage() {
    return window.location.pathname === '/';
  }

  // 1~5 사이 랜덤 정수를 생성
  function getRandomInt1to5() {
    return Math.floor(Math.random() * 5) + 1;
  }

  // 숫자 팝업 요소를 생성
  function createPopup(num) {
    const existing = document.getElementById('random-number-popup');
    if (existing) return existing;

    const popup = document.createElement('div');
    popup.id = 'random-number-popup';
    popup.textContent = num;
    // 스타일: 고정 위치, 오른쪽 위, 반투명 배경, 흰 글씨 등
    popup.style.position = 'fixed';
    popup.style.top = '30px';
    popup.style.left = '30px';
    popup.style.background = 'rgba(0, 0, 0, 0.6)';
    popup.style.color = '#ffffff';
    popup.style.fontSize = '60px';
    popup.style.fontWeight = 'bold';
    popup.style.padding = '6px 10px';
    popup.style.borderRadius = '5px';
    popup.style.zIndex = '9999';
    popup.style.pointerEvents = 'none'; // 클릭 막기

    document.body.appendChild(popup);
    return popup;
  }

  // 숫자 팝업을 제거
  function removePopup() {
    const existing = document.getElementById('random-number-popup');
    if (existing) {
      existing.remove();
    }
  }

  // 홈 화면일 때만 숫자 팝업 표시 또는 제거
  function updatePopup() {
    if (isHomePage()) {
      if (!document.getElementById('random-number-popup')) {
        const num = getRandomInt1to5();
        createPopup(num);
      }
    } else {
      removePopup();
    }
  }

  // 페이지 로드 시 한 번 실행
  window.addEventListener('load', () => {
    updatePopup();
  });

  // SPA 탐색이나 DOM 변경 시에도 업데이트
  const observer = new MutationObserver(() => {
    // 경로가 바뀌었거나, document.body가 다시 그려졌을 때
    updatePopup();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();