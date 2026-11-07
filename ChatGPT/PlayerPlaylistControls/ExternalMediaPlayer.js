// External-player integration inspired by 7dJx1qP's stashOpenMediaPlayer.
// Uses Stash's current component patches and raw file paths, without its old
// userscript-library, English XPath, file:// links, or Python dependency.
(function () {
  "use strict";

  var api = window.PluginApi;
  if (!api || !api.patch || !api.React) {
    return;
  }
  var React = api.React;
  var opening = false;
  var scheduled = false;
  var generation = 0;
  var fileSceneId = null;
  var files = [];
  var statusTimer = null;

  function sceneId() {
    var match = window.location.pathname.match(/\/scenes\/(\d+)\/?$/);
    return match ? match[1] : null;
  }

  function player() {
    var utils = api.utils && api.utils.InteractiveUtils;
    var current = utils && typeof utils.getPlayer === "function" ? utils.getPlayer() : null;
    return current && (!current.isDisposed || !current.isDisposed()) ? current : null;
  }

  function endpoint() {
    var prefix = window.location.pathname.replace(/\/scenes\/\d+\/?$/, "/");
    return new URL(prefix + "graphql", window.location.origin).toString();
  }

  async function graphql(query, variables) {
    var response = await fetch(endpoint(), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables }),
    });
    if (!response.ok) {
      throw new Error("Stash 요청 실패 (HTTP " + response.status + ")");
    }
    var result = await response.json();
    if (result.errors && result.errors.length) {
      throw new Error(result.errors[0].message || "Stash 요청 실패");
    }
    if (!result.data) {
      throw new Error("Stash 응답이 비어 있습니다.");
    }
    return result.data;
  }

  function updateControls() {
    var button = document.getElementById("spc-external-button");
    if (button) {
      button.disabled = opening;
      button.setAttribute("aria-busy", String(opening));
      var label = opening ? "여는 중…" : "외부 재생";
      if (button.textContent !== label) {
        button.textContent = label;
      }
    }
    document.querySelectorAll(".spc-file-path").forEach(function (element) {
      element.setAttribute("aria-disabled", String(opening));
    });
  }

  function showStatus(message, error) {
    var current = player();
    var root = current && current.el();
    if (!root) {
      return;
    }
    var status = root.querySelector(".spc-external-status");
    if (!status) {
      status = document.createElement("div");
      status.className = "spc-status spc-external-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      root.appendChild(status);
    }
    status.textContent = message;
    status.classList.toggle("spc-error", !!error);
    status.hidden = false;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () { status.hidden = true; }, error ? 7000 : 2500);
  }

  async function openExternalFile(path, expectedSceneId) {
    var id = expectedSceneId || sceneId();
    if (opening || !id || id !== sceneId()) {
      return;
    }
    var requestGeneration = generation;
    function isCurrent() {
      return sceneId() === id && generation === requestGeneration;
    }
    opening = true;
    updateControls();
    try {
      if (!path) {
        var sceneData = await graphql(
          "query ExternalPlayerFile($id: ID!) { findScene(id: $id) { files { id path } } }",
          { id: id }
        );
        if (!isCurrent()) {
          return;
        }
        var sceneFiles = sceneData.findScene && sceneData.findScene.files;
        path = sceneFiles && sceneFiles[0] && sceneFiles[0].path;
      }
      if (!path) {
        throw new Error("현재 영상의 원본 파일을 찾을 수 없습니다.");
      }
      var settingsData = await graphql(
        'query ExternalPlayerSettings { configuration { plugins(include: ["PlayerPlaylistControls", "stashOpenMediaPlayer"]) } }'
      );
      if (!isCurrent()) {
        return;
      }
      var settings = settingsData.configuration && settingsData.configuration.plugins;
      if (typeof settings === "string") {
        settings = JSON.parse(settings);
      }
      settings = settings || {};
      var own = settings.PlayerPlaylistControls || {};
      var legacy = settings.stashOpenMediaPlayer || {};
      var executable = String(own.mediaPlayerPath || "").trim() || String(legacy.mediaPlayerPath || "").trim();
      if (!executable) {
        throw new Error("설정 → 플러그인 → Player Playlist Controls에서 외부 플레이어 경로를 지정해 주세요.");
      }
      var data = await graphql(
        "mutation OpenExternalMediaPlayer($args: Map!) { " +
          'runPluginOperation(plugin_id: "PlayerPlaylistControls", args: $args) }',
        { args: { path: path, mediaPlayerPath: executable } }
      );
      if (!isCurrent()) {
        return;
      }
      if (!data.runPluginOperation || data.runPluginOperation.started !== true) {
        throw new Error("외부 플레이어의 실행을 확인하지 못했습니다.");
      }
      var current = player();
      if (current && typeof current.pause === "function") {
        current.pause();
      }
      showStatus("외부 플레이어에 파일 열기를 요청했습니다.", false);
    } catch (error) {
      console.error("PlayerPlaylistControls external player:", error);
      if (isCurrent()) {
        showStatus(error.message || "외부 플레이어를 실행하지 못했습니다.", true);
      }
    } finally {
      if (isCurrent()) {
        opening = false;
        updateControls();
      }
    }
  }

  api.patch.before("SceneFileInfoPanel", function (props) {
    fileSceneId = props.scene && String(props.scene.id);
    files = props.scene && props.scene.files ? props.scene.files : [];
    return [props];
  });

  // Patch the path's existing TruncatedText root, retaining Stash's tooltip,
  // layout and adjacent "reveal in filesystem" button. No localized labels
  // or URI decoding are involved; each alternate file retains its own path.
  api.patch.after("TruncatedText", function (props) {
    // React may pass a legacy context argument after props. Stash appends
    // the render result after every original argument, so it is always last.
    var result = arguments[arguments.length - 1];
    if (!result || fileSceneId !== sceneId() || typeof props.text !== "string") {
      return result;
    }
    var file = files.find(function (candidate) { return candidate.path === props.text; });
    if (!file) {
      return result;
    }
    var id = fileSceneId;
    var originalKeyDown = result.props && result.props.onKeyDown;
    return React.cloneElement(result, {
      className: ((result.props && result.props.className) || "") + " spc-file-path",
      role: "button",
      tabIndex: 0,
      title: "외부 플레이어로 재생",
      "aria-label": "외부 플레이어로 재생: " + file.path,
      "aria-disabled": String(opening),
      onClick: function (event) {
        event.preventDefault();
        event.stopPropagation();
        void openExternalFile(file.path, id);
      },
      onKeyDown: function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          void openExternalFile(file.path, id);
        } else if (typeof originalKeyDown === "function") {
          originalKeyDown(event);
        }
      },
    });
  });

  function ensureButton() {
    if (!sceneId()) {
      return;
    }
    var current = player();
    var root = current && current.el();
    var bar = root && root.querySelector(".vjs-control-bar");
    if (!bar || bar.querySelector("#spc-external-button")) {
      return;
    }
    var button = document.createElement("button");
    button.id = "spc-external-button";
    button.type = "button";
    button.className = "vjs-control vjs-button spc-button";
    button.title = "외부 플레이어로 원본 파일 재생";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      void openExternalFile();
    });
    button.addEventListener("keydown", function (event) { event.stopPropagation(); });
    bar.insertBefore(button, bar.querySelector(".vjs-fullscreen-control"));
    updateControls();
  }

  function scheduleButton() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.setTimeout(function () {
      scheduled = false;
      ensureButton();
    }, 50);
  }

  function onLocation() {
    generation += 1;
    opening = false;
    scheduleButton();
    updateControls();
  }

  function install() {
    new MutationObserver(scheduleButton).observe(document.body, { childList: true, subtree: true });
    if (api.Event && typeof api.Event.addEventListener === "function") {
      api.Event.addEventListener("stash:location", onLocation);
    }
    window.addEventListener("popstate", onLocation);
    window.setInterval(scheduleButton, 1000);
    scheduleButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
