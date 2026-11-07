(function () {
  "use strict";

  var api = window.PluginApi;
  if (!api || !api.patch || typeof api.patch.before !== "function") {
    console.error("PlayerPlaylistControls: Stash UI Plugin API is unavailable.");
    return;
  }

  var STORAGE_KEY = "stash-player-playlist.repeat";
  var repeat = false;
  var busy = false;
  var scheduled = false;
  var statusTimer = null;
  var sceneGeneration = 0;
  var renderedSceneId = null;
  var lastPlayer = null;

  try {
    repeat = window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch (_error) {
    // Private browsing can disable storage; in-memory controls still work.
  }

  function getSceneId() {
    var match = window.location.pathname.match(/\/scenes\/(\d+)\/?$/);
    return match ? match[1] : null;
  }

  function getPlayer() {
    var utils = api.utils && api.utils.InteractiveUtils;
    var player = utils && typeof utils.getPlayer === "function" ? utils.getPlayer() : null;
    if (player && (!player.isDisposed || !player.isDisposed())) {
      return player;
    }
    return null;
  }

  function syncLoop(player) {
    if (player && typeof player.loop === "function" && player.loop() !== repeat) {
      player.loop(repeat);
    }
  }

  function setRepeat(enabled) {
    repeat = enabled;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch (_error) {
      // Storage is optional.
    }
    syncLoop(getPlayer());
    updateButtons();
  }

  function replay() {
    var player = getPlayer();
    if (!player) {
      return;
    }
    player.currentTime(0);
    var playback = player.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(function (error) {
        console.warn("PlayerPlaylistControls: replay could not start.", error);
        showStatus("반복 재생을 시작하려면 재생 버튼을 눌러 주세요.", true);
      });
    }
  }

  // Guard Stash's actual queue-completion callback. This also works when
  // another plugin (e.g. UltimateQueueAndPreview) keeps Continue enabled.
  api.patch.before("ScenePlayer", function (props) {
    var nextProps = Object.assign({}, props);
    var onComplete = props.onComplete;
    var sceneId = props.scene && String(props.scene.id);
    nextProps.permitLoop = false;
    nextProps.onComplete = function () {
      if (repeat && getSceneId() === sceneId) {
        replay();
        return;
      }
      if (typeof onComplete === "function") {
        return onComplete.apply(this, arguments);
      }
    };
    scheduleControls();
    return [nextProps];
  });

  function graphqlEndpoint() {
    // Respect a reverse-proxy prefix, e.g. /stash/scenes/123.
    var prefix = window.location.pathname.replace(/\/scenes\/\d+\/?$/, "/");
    return new URL(prefix + "graphql", window.location.origin).toString();
  }

  async function callGraphQL(query, variables) {
    var response = await fetch(graphqlEndpoint(), {
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
      throw new Error("Stash에서 재생목록 정보를 받지 못했습니다.");
    }
    return result.data;
  }

  function makePlaylist(scene, kind) {
    if (kind === "folder") {
      var folder = scene.files && scene.files[0] && scene.files[0].parent_folder;
      if (!folder || !folder.id) {
        throw new Error("현재 영상의 원본 폴더를 찾을 수 없습니다.");
      }
      return {
        criterion: {
          type: "folder",
          modifier: "INCLUDES",
          value: { items: [{ id: folder.id, label: folder.path }], excluded: [], depth: 0 },
        },
        filter: {
          files_filter: {
            parent_folder: { value: [folder.id], modifier: "INCLUDES", depth: 0 },
          },
        },
      };
    }

    var performers = scene.performers || [];
    if (!performers.length) {
      throw new Error("현재 영상에 등록된 배우가 없습니다.");
    }
    return {
      criterion: {
        type: "performers",
        modifier: "INCLUDES",
        value: {
          items: performers.map(function (performer) {
            return { id: performer.id, label: performer.name };
          }),
          excluded: [],
        },
      },
      filter: {
        performers: {
          value: performers.map(function (performer) { return performer.id; }),
          modifier: "INCLUDES",
        },
      },
    };
  }

  function isCurrentRequest(sceneId, generation) {
    return getSceneId() === sceneId && sceneGeneration === generation;
  }

  async function startPlaylist(kind) {
    var sceneId = getSceneId();
    if (!sceneId || busy) {
      return;
    }
    var generation = sceneGeneration;
    busy = true;
    updateButtons();
    showStatus("랜덤 재생목록을 만드는 중…", false);

    try {
      var data = await callGraphQL(
        "query PlayerPlaylistScene($id: ID!) { findScene(id: $id) { " +
          "files { parent_folder { id path } } performers { id name } } }",
        { id: sceneId }
      );
      if (!isCurrentRequest(sceneId, generation)) {
        return;
      }
      if (!data.findScene) {
        throw new Error("현재 영상을 찾을 수 없습니다.");
      }
      var playlist = makePlaylist(data.findScene, kind);
      var sort = "random_" + String(Math.floor(Math.random() * 90000000) + 10000000);
      var results = await callGraphQL(
        "query PlayerPlaylistFirst($filter: FindFilterType!, $scene_filter: SceneFilterType!) { " +
          "findScenes(filter: $filter, scene_filter: $scene_filter) { count scenes { id } } }",
        {
          filter: { sort: sort, direction: "ASC", page: 1, per_page: 1 },
          scene_filter: playlist.filter,
        }
      );
      if (!isCurrentRequest(sceneId, generation)) {
        return;
      }
      var matches = results.findScenes;
      if (!matches || !matches.scenes || !matches.scenes.length) {
        throw new Error("재생할 영상이 없습니다.");
      }

      // A fixed random seed keeps the native queue stable across its pages.
      // Query-backed queues do not load every ID or overflow long URLs.
      var params = new URLSearchParams({
        qsort: sort,
        qsortd: "asc",
        qfp: "1",
        autoplay: "true",
        continue: "true",
      });
      params.append("qfc", JSON.stringify(playlist.criterion));
      var prefix = window.location.pathname.replace(/\/scenes\/\d+\/?$/, "/scenes/");
      setRepeat(false);
      window.location.assign(prefix + encodeURIComponent(matches.scenes[0].id) + "?" + params.toString());
    } catch (error) {
      console.error("PlayerPlaylistControls:", error);
      if (isCurrentRequest(sceneId, generation)) {
        showStatus(error.message || "재생목록을 만들지 못했습니다.", true);
      }
    } finally {
      if (isCurrentRequest(sceneId, generation)) {
        busy = false;
        updateButtons();
      }
    }
  }

  function showStatus(message, isError) {
    var player = getPlayer();
    var root = player && player.el();
    if (!root) {
      return;
    }
    var status = root.querySelector(".spc-status");
    if (!status) {
      status = document.createElement("div");
      status.className = "spc-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      root.appendChild(status);
    }
    status.textContent = message;
    status.classList.toggle("spc-error", !!isError);
    status.hidden = false;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () { status.hidden = true; }, isError ? 6000 : 3000);
  }

  function updateButtons() {
    var button = document.getElementById("spc-repeat-button");
    if (button) {
      var label = repeat ? "Repeat ON" : "Repeat OFF";
      if (button.textContent !== label) {
        button.textContent = label;
      }
      button.setAttribute("aria-pressed", String(repeat));
      button.title = repeat ? "현재 영상 반복 중 (누르면 해제)" : "현재 영상 반복하기";
      button.setAttribute("aria-label", button.title);
    }
    ["spc-folder-button", "spc-performer-button"].forEach(function (id) {
      var playlistButton = document.getElementById(id);
      if (playlistButton) {
        playlistButton.disabled = busy;
        playlistButton.setAttribute("aria-busy", String(busy));
      }
    });
  }

  function createButton(id, label, title, onClick) {
    var button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "vjs-control vjs-button spc-button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    // Prevent Stash's player-level space/Enter shortcuts from swallowing
    // keyboard activation of our focused buttons.
    button.addEventListener("keydown", function (event) { event.stopPropagation(); });
    return button;
  }

  function ensureControls() {
    var sceneId = getSceneId();
    if (sceneId !== renderedSceneId) {
      sceneGeneration += 1;
      renderedSceneId = sceneId;
      busy = false;
    }
    if (!sceneId) {
      return;
    }
    var player = getPlayer();
    var root = player && player.el();
    var bar = root && root.querySelector(".vjs-control-bar");
    if (!bar) {
      return;
    }
    if (player !== lastPlayer) {
      lastPlayer = player;
      player.on("loadstart", scheduleControls);
    }
    if (!bar.querySelector("#spc-repeat-button")) {
      var repeatButton = createButton("spc-repeat-button", "Repeat OFF", "현재 영상 반복하기", function () {
        setRepeat(!repeat);
      });
      var folderButton = createButton("spc-folder-button", "폴더 플리", "같은 폴더의 영상을 랜덤 순서로 재생", function () {
        void startPlaylist("folder");
      });
      var performerButton = createButton("spc-performer-button", "캐릭터 플리", "현재 영상에 등록된 배우의 출연작을 랜덤 순서로 재생", function () {
        void startPlaylist("performer");
      });
      var fullscreen = bar.querySelector(".vjs-fullscreen-control");
      [repeatButton, folderButton, performerButton].forEach(function (button) {
        bar.insertBefore(button, fullscreen);
      });
    }
    syncLoop(player);
    updateButtons();
  }

  function scheduleControls() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.setTimeout(function () {
      scheduled = false;
      ensureControls();
    }, 50);
  }

  function install() {
    var observer = new MutationObserver(scheduleControls);
    observer.observe(document.body, { childList: true, subtree: true });
    if (api.Event && typeof api.Event.addEventListener === "function") {
      api.Event.addEventListener("stash:location", function () {
        // Invalidate in-flight requests even if navigation returns to the
        // same scene before the scheduled DOM update runs.
        sceneGeneration += 1;
        busy = false;
        scheduleControls();
      });
    }
    window.addEventListener("popstate", scheduleControls);
    // Also handle player creation/replacement without a DOM mutation.
    window.setInterval(scheduleControls, 1000);
    scheduleControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
