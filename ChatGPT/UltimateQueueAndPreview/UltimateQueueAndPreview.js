// UltimateQueueAndPreview.js
// Unified plugin for:
// 1) AutoContinueQueue
// 2) PlayVideoIfPreviewNotFound
// Minimal helpers only (no external TetraxUserscriptLibrary dependency).

(function () {
  "use strict";

  var CHECKED_ATTR = "data-uqp-checked-preview";
  var CHECKING_ATTR = "data-uqp-checking-preview";
  var scanTimer = null;

  // Minimal helper inspired by TetraxUserscriptLibrary: wait for an element.
  function waitForElement(selector, timeoutMs, root) {
    var waitTimeout = typeof timeoutMs === "number" ? timeoutMs : 0;
    var waitRoot = root || document;

    return new Promise(function (resolve) {
      var found = document.querySelector(selector);
      if (found) {
        resolve(found);
        return;
      }

      var observer = new MutationObserver(function () {
        var target = document.querySelector(selector);
        if (target) {
          observer.disconnect();
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          resolve(target);
        }
      });

      try {
        observer.observe(waitRoot, { childList: true, subtree: true });
      } catch (_err) {
        resolve(null);
        return;
      }

      var timeoutId = null;
      if (waitTimeout > 0) {
        timeoutId = setTimeout(function () {
          observer.disconnect();
          resolve(null);
        }, waitTimeout);
      }
    });
  }

  // Minimal helper inspired by TetraxUserscriptLibrary: route-change triggers.
  function addRouteChangeListener(callback) {
    var run = function () {
      setTimeout(callback, 0);
      setTimeout(callback, 250);
    };

    if (
      window.PluginApi &&
      window.PluginApi.Event &&
      typeof window.PluginApi.Event.addEventListener === "function"
    ) {
      window.PluginApi.Event.addEventListener("stash:location", run);
    }

    var originalPushState = history.pushState;
    if (typeof originalPushState === "function") {
      history.pushState = function () {
        var result = originalPushState.apply(this, arguments);
        run();
        return result;
      };
    }

    var originalReplaceState = history.replaceState;
    if (typeof originalReplaceState === "function") {
      history.replaceState = function () {
        var result = originalReplaceState.apply(this, arguments);
        run();
        return result;
      };
    }

    window.addEventListener("popstate", run);
    window.addEventListener("hashchange", run);

    // Failsafe for missed SPA signals.
    setInterval(callback, 2000);
  }

  function isSceneDetailPage() {
    return /^\/scenes\/\d+/.test(window.location.pathname);
  }

  function autoEnableContinue() {
    if (!isSceneDetailPage()) {
      return;
    }

    if (!document.querySelector("#queue-viewer")) {
      return;
    }

    var checkbox = document.getElementById("continue-checkbox");
    if (!checkbox || checkbox.checked) {
      return;
    }

    checkbox.click();
  }

  function getPreviewTarget(video) {
    if (!video) {
      return null;
    }

    var videoSrc =
      video.getAttribute("src") ||
      video.currentSrc ||
      video.src ||
      "";

    if (videoSrc && videoSrc.indexOf("/preview") !== -1) {
      return {
        type: "video",
        video: video,
        sourceEl: null,
        url: videoSrc,
      };
    }

    var sourceEl = video.querySelector('source[src*="/preview"]');
    if (sourceEl) {
      return {
        type: "source",
        video: video,
        sourceEl: sourceEl,
        url: sourceEl.getAttribute("src") || "",
      };
    }

    return null;
  }

  function replacePreviewWithStream(target) {
    if (!target || !target.url) {
      return;
    }

    var streamUrl = target.url.replace("/preview", "/stream");

    if (target.type === "source" && target.sourceEl) {
      target.sourceEl.setAttribute("src", streamUrl);
      if (target.video && typeof target.video.load === "function") {
        target.video.load();
      }
      return;
    }

    if (target.video) {
      target.video.setAttribute("src", streamUrl);
      target.video.src = streamUrl;
    }
  }

  async function getResponseStatus(url) {
    try {
      var head = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        credentials: "same-origin",
      });

      if (head.status !== 405 && head.status !== 501) {
        return head.status;
      }
    } catch (_headErr) {
      // Fall through to ranged GET.
    }

    try {
      var rangedGet = await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Range: "bytes=0-1",
        },
      });
      return rangedGet.status;
    } catch (_getErr) {
      return 0;
    }
  }

  async function ensurePreviewFallback(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    var target = getPreviewTarget(video);
    if (!target || !target.url) {
      return;
    }

    if (video.getAttribute(CHECKED_ATTR) === target.url) {
      return;
    }

    if (video.getAttribute(CHECKING_ATTR) === target.url) {
      return;
    }

    video.setAttribute(CHECKING_ATTR, target.url);

    try {
      var status = await getResponseStatus(target.url);
      if (status !== 200 && status !== 206) {
        replacePreviewWithStream(target);
      }
    } catch (_err) {
      replacePreviewWithStream(target);
    } finally {
      video.removeAttribute(CHECKING_ATTR);
      video.setAttribute(CHECKED_ATTR, target.url);
    }
  }

  function scanPreviewVideos(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var videos = scope.querySelectorAll(".scene-card-preview-video");
    videos.forEach(function (video) {
      ensurePreviewFallback(video);
    });
  }

  function schedulePreviewScan(root) {
    if (scanTimer !== null) {
      return;
    }

    scanTimer = setTimeout(function () {
      scanTimer = null;
      scanPreviewVideos(root || document);
    }, 100);
  }

  function runFeatures() {
    autoEnableContinue();
    schedulePreviewScan(document);
  }

  function installDomObservers() {
    var observer = new MutationObserver(function (mutations) {
      var shouldRun = false;

      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
          shouldRun = true;
          break;
        }
      }

      if (shouldRun) {
        runFeatures();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Scene preview videos are often hover-triggered; scan when pointer enters cards.
    document.addEventListener(
      "mouseenter",
      function (event) {
        var target = event.target;
        if (!target || typeof target.closest !== "function") {
          return;
        }

        var card = target.closest(".scene-card");
        if (card) {
          schedulePreviewScan(card);
        }
      },
      true
    );
  }

  async function init() {
    var body = await waitForElement("body", 10000, document.documentElement || document);
    if (!body) {
      return;
    }

    addRouteChangeListener(runFeatures);
    installDomObservers();

    window.addEventListener("load", runFeatures);
    runFeatures();
  }

  init();
})();
